import * as vscode from "vscode";
import { PromptAnalyzer } from "../../analysis/promptAnalyzer";
import { LocalPromptAdvisor } from "../../analysis/localPromptAdvisor";
import { GroqGateway } from "../../integrations/groq/groqGateway";
import { HistoryStore } from "../../history/historyStore";
import { OptimizationLedgerStore } from "../../history/optimizationLedger";
import { AnalysisResult, PromptHistoryEntry } from "../../types";
import { NavigatorProvider } from "../../ui/navigator";
import { OnboardingGate } from "../onboarding/onboardingGate";
import { PromptTraceLogger, PromptTraceSnapshot } from "../tracing/promptTraceLogger";

export interface PromptExecutionOptions {
  withGroq: boolean;
  source: "editor" | "local-chat" | "chat-participant" | "on-save";
  disabledRules: readonly string[];
}

export interface PromptExecutionOutcome {
  result: AnalysisResult;
  cloudPromptId?: string;
  traceId: string;
  ledgerPath: string;
}

export class PromptExecutionService {
  private readonly judgementCache = new Map<string, { expiresAt: number; score: number; rationale: string; costUsd: number }>();
  private readonly advisor = new LocalPromptAdvisor();

  constructor(
    private readonly analyzer: PromptAnalyzer,
    private readonly groq: GroqGateway,
    private readonly onboarding: OnboardingGate,
    private readonly history: HistoryStore,
    private readonly ledger: OptimizationLedgerStore,
    private readonly navigator: NavigatorProvider,
    private readonly traces: PromptTraceLogger
  ) {}

  async analyzeAndPersist(prompt: string, options: PromptExecutionOptions): Promise<PromptExecutionOutcome> {
    const trace = this.traces.start(options.source);
    const authorization = await this.onboarding.authorizeForGroq();
    this.traces.step(trace, {
      phase: "onboarding-gate",
      details: {
        source: options.source,
        allowed: authorization.allowed,
        onboardingState: authorization.state,
        onboardingStage: authorization.stage,
        reason: authorization.reason,
        apiStatus: authorization.httpStatus
      }
    });

    let cloudPromptId: string | undefined;
    if (authorization.allowed) {
      try {
        cloudPromptId = await this.persistPromptOrThrow(prompt, trace);
      } catch (error) {
        this.traces.step(trace, { phase: "prompt-persist-failed", details: { message: error instanceof Error ? error.message : "unknown" } });
      }
    }

    const result = this.analyzer.analyze(prompt, options.disabledRules);
    result.localInsights = this.advisor.build(prompt, authorization.allowed ? "cloud-assisted" : "local-only");
    this.traces.step(trace, { phase: "local-analysis", details: { findings: result.issues.length, score: result.score.total, inputTokens: result.cost.inputTokens } });

    let enriched = result;
    if (!authorization.allowed) {
      enriched = this.markLocalOnly(result, authorization.reason ?? authorization.stage);
    } else if (options.withGroq) {
      enriched = await this.enrichWithGroqJudgement(result, prompt, trace);
    } else {
      enriched = this.markLocalOnly(result);
    }

    const optimizedTokens = Math.ceil(enriched.optimization.optimizedPrompt.length / 4);
    await this.history.add({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      timestamp: enriched.analyzedAt,
      originalPrompt: prompt,
      optimizedPrompt: enriched.optimization.optimizedPrompt,
      score: enriched.score.total,
      improvement: Math.max(0, 100 - enriched.score.total),
      estimatedSavings: enriched.cost.potentialSavingsUsd ?? 0
    });
    await this.ledger.record({
      source: options.source,
      projectName: this.projectName(),
      inputPrompt: prompt,
      outputPrompt: enriched.optimization.optimizedPrompt,
      inputTokens: enriched.cost.inputTokens,
      outputTokens: optimizedTokens,
      estimatedSavingsUsd: enriched.cost.potentialSavingsUsd ?? 0,
      score: enriched.score.total
    });

    this.navigator.refresh();
    this.traces.step(trace, {
      phase: "persisted",
      details: {
        cloudPromptId: cloudPromptId ?? "none",
        scoreSource: enriched.scoreSource,
        beforeTokens: enriched.cost.inputTokens,
        afterTokens: optimizedTokens,
        tokenDelta: enriched.cost.inputTokens - optimizedTokens
      }
    });
    this.traces.end(trace, { finalScore: enriched.score.total, finalFindings: enriched.issues.length });

    return { result: enriched, cloudPromptId, traceId: trace.traceId, ledgerPath: ".promptguard/prompt-optimizations.json" };
  }

  async enrichHistoryEntry(result: AnalysisResult, entry: PromptHistoryEntry, source: PromptExecutionOptions["source"], withGroq = true): Promise<{ result: AnalysisResult; cloudPromptId?: string; entry: PromptHistoryEntry; traceId: string; ledgerPath: string }> {
    const trace = this.traces.start(source);
    const authorization = await this.onboarding.authorizeForGroq();
    this.traces.step(trace, {
      phase: "onboarding-gate",
      details: {
        source,
        allowed: authorization.allowed,
        onboardingState: authorization.state,
        onboardingStage: authorization.stage,
        reason: authorization.reason,
        apiStatus: authorization.httpStatus
      }
    });

    let cloudPromptId: string | undefined;
    if (authorization.allowed) {
      try {
        cloudPromptId = await this.persistPromptOrThrow(entry.originalPrompt, trace);
      } catch (error) {
        this.traces.step(trace, { phase: "prompt-persist-failed", details: { message: error instanceof Error ? error.message : "unknown" } });
      }
    }

    result.localInsights = this.advisor.build(entry.originalPrompt, authorization.allowed ? "cloud-assisted" : "local-only");
    this.traces.step(trace, { phase: "local-analysis", details: { findings: result.issues.length, score: result.score.total, inputTokens: result.cost.inputTokens } });

    const enriched = authorization.allowed && withGroq ? await this.enrichWithGroqJudgement(result, entry.originalPrompt, trace) : this.markLocalOnly(result, withGroq ? (authorization.reason ?? authorization.stage) : "user-selected-local-path");
    const updatedEntry: PromptHistoryEntry = {
      ...entry,
      score: enriched.score.total,
      improvement: Math.max(0, 100 - enriched.score.total),
      estimatedSavings: enriched.cost.potentialSavingsUsd ?? 0
    };

    const optimizedTokens = Math.ceil(enriched.optimization.optimizedPrompt.length / 4);
    await this.history.add(updatedEntry);
    await this.ledger.record({
      source,
      projectName: this.projectName(),
      inputPrompt: entry.originalPrompt,
      outputPrompt: enriched.optimization.optimizedPrompt,
      inputTokens: enriched.cost.inputTokens,
      outputTokens: optimizedTokens,
      estimatedSavingsUsd: enriched.cost.potentialSavingsUsd ?? 0,
      score: enriched.score.total
    });
    this.navigator.refresh();
    this.traces.step(trace, {
      phase: "persisted",
      details: {
        cloudPromptId: cloudPromptId ?? "none",
        scoreSource: enriched.scoreSource,
        beforeTokens: enriched.cost.inputTokens,
        afterTokens: optimizedTokens,
        tokenDelta: enriched.cost.inputTokens - optimizedTokens
      }
    });
    this.traces.end(trace, { finalScore: enriched.score.total, finalFindings: enriched.issues.length });

    return { result: enriched, cloudPromptId, entry: updatedEntry, traceId: trace.traceId, ledgerPath: ".promptguard/prompt-optimizations.json" };
  }

  private async enrichWithGroqJudgement(result: AnalysisResult, prompt: string, trace: PromptTraceSnapshot): Promise<AnalysisResult> {
    const authorization = await this.onboarding.authorizeForGroq();
    if (!authorization.allowed) {
      result.groqStatus = `Groq disabled (${authorization.stage}): ${authorization.reason ?? "Onboarding incomplete."}`;
      this.traces.step(trace, {
        phase: "groq-skip",
        details: {
          reason: authorization.reason,
          onboardingState: authorization.state,
          onboardingStage: authorization.stage,
          apiStatus: authorization.httpStatus
        }
      });
      return result;
    }

    if (!await this.groq.isConfigured()) {
      result.groqStatus = "Groq not configured — score is local-only.";
      this.traces.step(trace, { phase: "groq-skip", details: { reason: "not-configured" } });
      return result;
    }

    try {
      const cached = this.judgementCache.get(result.prompt);
      const judgement = cached && cached.expiresAt > Date.now() ? cached : await this.groq.judge(result.prompt, result.issues.map(issue => `${issue.title}: ${issue.description}`));
      if (!cached || cached.expiresAt <= Date.now()) {
        this.judgementCache.set(result.prompt, { ...judgement, expiresAt: Date.now() + 30 * 60 * 1000 });
      }

      const total = judgement.score;
      result.score.total = total;
      result.score.grade = total >= 85 ? "Excellent" : total >= 70 ? "Strong" : total >= 50 ? "Needs work" : "At risk";
      result.scoreSource = "groq";
      result.groqStatus = cached && cached.expiresAt > Date.now()
        ? "Groq semantic judgement applied (cached)."
        : "Groq semantic judgement applied; local rules remain advisory and safety-focused.";
      await this.applyGroqOptimization(result, prompt, trace);
      result.issues.unshift({
        id: "groq-semantic-judgement",
        ruleId: "groq-semantic-judgement",
        title: "Groq semantic assessment",
        description: judgement.rationale,
        severity: judgement.score < 50 ? "warning" : "info",
        confidence: 0.9,
        category: "specificity",
        suggestedFix: "Address the missing context identified by the semantic assessment.",
        estimatedTokenSavings: 0,
        estimatedCostSavings: judgement.costUsd
      });
      this.traces.step(trace, { phase: "groq-judgement", details: { score: total, cached: Boolean(cached && cached.expiresAt > Date.now()) } });
    } catch (error) {
      result.groqStatus = `Groq judgement unavailable — local-only score (${error instanceof Error ? error.message : "unknown error"}).`;
      this.traces.step(trace, { phase: "groq-failed", details: { message: error instanceof Error ? error.message : "unknown" } });
    }

    return result;
  }

  private async applyGroqOptimization(result: AnalysisResult, prompt: string, trace: PromptTraceSnapshot): Promise<void> {
    try {
      const context = result.issues.map(issue => `${issue.title}: ${issue.suggestedFix}`).join("\n");
      const improved = await this.groq.improveWithContext(prompt, context, result.issues.map(issue => `${issue.title}: ${issue.suggestedFix}`), "compress");
      const candidate = improved.improvedPrompt.trim();
      if (candidate.length > 0) {
        result.optimization = {
          ...result.optimization,
          title: "Groq-optimized prompt",
          reason: "Groq compressed the prompt while preserving meaning.",
          optimizedPrompt: candidate
        };
        this.traces.step(trace, { phase: "groq-improve", details: { outputTokens: improved.outputTokens } });
      }
    } catch (error) {
      this.traces.step(trace, { phase: "groq-improve-failed", details: { message: error instanceof Error ? error.message : "unknown" } });
    }
  }

  private markLocalOnly(result: AnalysisResult, reason = "Local mode enabled"): AnalysisResult {
    result.groqStatus = `Local-only analysis active (${reason}). PromptGuard still provides best practices and model recommendations.`;
    return result;
  }

  clearCaches(): void {
    this.judgementCache.clear();
  }

  private async persistPromptOrThrow(prompt: string, trace: PromptTraceSnapshot): Promise<string> {
    const cloudPromptId = await this.onboarding.recordOriginalPrompt(prompt);
    this.traces.step(trace, { phase: "prompt-persisted", details: { cloudPromptId: cloudPromptId ?? "none" } });
    if (!cloudPromptId) {
      throw new Error("Prompt could not be saved to the PromptGuard backend.");
    }
    return cloudPromptId;
  }

  private projectName(): string {
    return vscode.workspace.workspaceFolders?.[0]?.name ?? vscode.workspace.name ?? "workspace";
  }
}
