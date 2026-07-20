import * as vscode from "vscode";
import { PromptAnalyzer } from "../../analysis/promptAnalyzer";
import { LocalPromptAdvisor } from "../../analysis/localPromptAdvisor";
import { GroqGateway } from "../../integrations/groq/groqGateway";
import { HistoryStore } from "../../history/historyStore";
import { OptimizationLedgerStore } from "../../history/optimizationLedger";
import { AnalysisResult, PromptHistoryEntry } from "../../types";
import { NavigatorProvider } from "../../ui/navigator";
import { PromptLearningService } from "../learning/promptLearningService";
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
  private readonly compressionCache = new Map<string, { expiresAt: number; improvedPrompt: string; outputTokens: number; costUsd: number }>();
  private readonly advisor = new LocalPromptAdvisor();

  private static readonly MIN_COMPRESSION_WIN_TOKENS = 4;
  private static readonly LOCAL_COMPRESSION_GOAL_TOKENS = 8;

  constructor(
    private readonly analyzer: PromptAnalyzer,
    private readonly groq: GroqGateway,
    private readonly onboarding: OnboardingGate,
    private readonly history: HistoryStore,
    private readonly ledger: OptimizationLedgerStore,
    private readonly navigator: NavigatorProvider,
    private readonly traces: PromptTraceLogger,
    private readonly learning: PromptLearningService
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
    result.localInsights = this.advisor.build(prompt, authorization.allowed ? "cloud-assisted" : "local-only", this.learning.summarize());
    this.traces.step(trace, { phase: "local-analysis", details: { findings: result.issues.length, score: result.score.total, inputTokens: result.cost.inputTokens } });

    let enriched = result;
    const shouldEscalate = this.shouldEscalateToGroq(options.withGroq, result);
    this.traces.step(trace, {
      phase: "route-selection",
      details: {
        requestedGroq: options.withGroq,
        escalatedToGroq: shouldEscalate,
        score: result.score.total,
        findings: result.issues.length
      }
    });
    if (!authorization.allowed) {
      enriched = this.markLocalOnly(result, authorization.reason ?? authorization.stage);
    } else if (shouldEscalate) {
      enriched = await this.enrichWithGroqJudgement(result, prompt, trace);
    } else if (options.withGroq) {
      enriched = this.markLocalOnly(result, "local-first routing kept this prompt on local scoring");
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

    result.localInsights = this.advisor.build(entry.originalPrompt, authorization.allowed ? "cloud-assisted" : "local-only", this.learning.summarize());
    this.traces.step(trace, { phase: "local-analysis", details: { findings: result.issues.length, score: result.score.total, inputTokens: result.cost.inputTokens } });

    const shouldEscalate = this.shouldEscalateToGroq(withGroq, result);
    this.traces.step(trace, {
      phase: "route-selection",
      details: {
        requestedGroq: withGroq,
        escalatedToGroq: shouldEscalate,
        score: result.score.total,
        findings: result.issues.length
      }
    });
    const enriched = authorization.allowed && shouldEscalate
      ? await this.enrichWithGroqJudgement(result, entry.originalPrompt, trace)
      : this.markLocalOnly(result, withGroq ? (shouldEscalate ? (authorization.reason ?? authorization.stage) : "local-first routing kept this prompt on local scoring") : "user-selected-local-path");
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

  private markLocalOnly(result: AnalysisResult, reason = "Local mode enabled"): AnalysisResult {
    result.groqStatus = `Local-only analysis active (${reason}). PromptGuard still provides best practices and model recommendations.`;
    return result;
  }

  clearCaches(): void {
    this.judgementCache.clear();
    this.compressionCache.clear();
  }

  private shouldEscalateToGroq(requestedGroq: boolean, result: AnalysisResult): boolean {
    if (!requestedGroq) return false;
    if (result.score.total <= 82) return true;
    if (result.issues.length >= 4) return true;
    return result.issues.some(issue => issue.severity === "warning");
  }

  private async applyGroqCompression(result: AnalysisResult, prompt: string, trace: PromptTraceSnapshot): Promise<void> {
    const findings = result.issues
      .filter(issue => issue.ruleId !== "groq-semantic-judgement")
      .map(issue => `${issue.title}: ${issue.suggestedFix || issue.description}`);
    const context = findings.join("\n");
    const cacheKey = `${prompt}\n---\n${context}`;

    try {
      const localCandidates = [
        { method: "caveman", text: this.cavemanCompress(prompt) },
        { method: "rtk", text: this.rtkCompress(prompt) }
      ]
        .map(candidate => this.evaluateCompressionCandidate(prompt, candidate.text, candidate.method))
        .filter((candidate): candidate is { method: string; text: string; beforeTokens: number; afterTokens: number; reducedTokens: number } => Boolean(candidate));

      const bestLocal = localCandidates.sort((a, b) => b.reducedTokens - a.reducedTokens)[0];
      if (bestLocal) {
        this.traces.step(trace, {
          phase: "local-compress",
          details: {
            method: bestLocal.method,
            beforeTokens: bestLocal.beforeTokens,
            afterTokens: bestLocal.afterTokens,
            reducedTokens: bestLocal.reducedTokens
          }
        });
      } else {
        this.traces.step(trace, { phase: "local-compress-skip", details: { reason: "no-safe-local-candidate" } });
      }

      if (bestLocal && bestLocal.reducedTokens >= PromptExecutionService.LOCAL_COMPRESSION_GOAL_TOKENS) {
        this.applyCompressionResult(result, bestLocal.method, bestLocal.text, bestLocal.reducedTokens, 0);
        return;
      }

      const cached = this.compressionCache.get(cacheKey);
      const response = cached && cached.expiresAt > Date.now()
        ? { improvedPrompt: cached.improvedPrompt, outputTokens: cached.outputTokens, costUsd: cached.costUsd }
        : await this.groq.improveWithContext(prompt, context, findings, "compress");

      if (!cached || cached.expiresAt <= Date.now()) {
        this.compressionCache.set(cacheKey, { ...response, expiresAt: Date.now() + 30 * 60 * 1000 });
      }

      const groqCandidate = this.evaluateCompressionCandidate(prompt, response.improvedPrompt.trim(), "groq");
      const winner = [bestLocal, groqCandidate]
        .filter((candidate): candidate is { method: string; text: string; beforeTokens: number; afterTokens: number; reducedTokens: number } => Boolean(candidate))
        .sort((a, b) => b.reducedTokens - a.reducedTokens)[0];

      if (!winner) {
        this.traces.step(trace, {
          phase: "groq-compress-skip",
          details: { reason: "no-safe-candidate", cached: Boolean(cached && cached.expiresAt > Date.now()) }
        });
        return;
      }

      this.applyCompressionResult(result, winner.method, winner.text, winner.reducedTokens, winner.method === "groq" ? response.costUsd : 0);
      this.traces.step(trace, {
        phase: winner.method === "groq" ? "groq-compress" : "local-compress-selected",
        details: {
          method: winner.method,
          cached: Boolean(cached && cached.expiresAt > Date.now()),
          beforeTokens: winner.beforeTokens,
          afterTokens: winner.afterTokens,
          reducedTokens: winner.reducedTokens,
          compressionCostUsd: winner.method === "groq" ? response.costUsd : 0
        }
      });
    } catch (error) {
      this.traces.step(trace, { phase: "groq-compress-failed", details: { message: error instanceof Error ? error.message : "unknown" } });
    }
  }

  private applyCompressionResult(result: AnalysisResult, method: string, optimizedPrompt: string, reducedTokens: number, compressionCostUsd: number): void {
    const prettyMethod = method === "rtk" ? "RTK" : method === "caveman" ? "Caveman" : "Groq";
    result.optimization = {
      ...result.optimization,
      title: `${prettyMethod} token-optimized prompt`,
      reason: `${prettyMethod} compression reduced about ${reducedTokens} tokens while preserving intent and constraints.`,
      optimizedPrompt
    };

    const costSuffix = compressionCostUsd > 0 ? ` (compression cost $${compressionCostUsd.toFixed(6)})` : "";
    result.groqStatus = `${result.groqStatus ?? "Compression applied."} ${prettyMethod} compression applied.${costSuffix}`;
  }

  private evaluateCompressionCandidate(original: string, candidate: string, method: string): { method: string; text: string; beforeTokens: number; afterTokens: number; reducedTokens: number } | undefined {
    const text = candidate.trim();
    const beforeTokens = this.estimateTokens(original);
    const afterTokens = this.estimateTokens(text);
    const reducedTokens = beforeTokens - afterTokens;
    if (!text || text.length >= original.length || afterTokens >= beforeTokens || reducedTokens < PromptExecutionService.MIN_COMPRESSION_WIN_TOKENS) return undefined;
    if (!this.preservesCriticalConstraints(original, text)) return undefined;
    if (this.looksLikeCompletedArtifact(original, text)) return undefined;
    return { method, text, beforeTokens, afterTokens, reducedTokens };
  }

  private cavemanCompress(prompt: string): string {
    let compressed = prompt;
    compressed = compressed.replace(/\b(?:please|kindly|just|really|basically|actually|simply)\b/gi, "");
    compressed = compressed.replace(/\b(?:in order to|due to the fact that|at this point in time)\b/gi, (match) => {
      const lower = match.toLowerCase();
      if (lower === "in order to") return "to";
      if (lower === "due to the fact that") return "because";
      return "now";
    });
    compressed = compressed.replace(/\b([A-Za-z]{3,})\s+\1\b/gi, "$1");
    compressed = compressed.replace(/\s{2,}/g, " ");
    compressed = compressed.replace(/\s+([,.;:!?])/g, "$1");
    compressed = compressed.replace(/([,.;:!?])(\S)/g, "$1 $2");
    return compressed.trim();
  }

  private rtkCompress(prompt: string): string {
    const segments = this.segmentPrompt(prompt);
    if (!segments.length) return prompt;

    const targetTokens = Math.max(24, Math.floor(this.estimateTokens(prompt) * 0.78));
    const ranked = segments
      .map(segment => ({ segment, score: this.rtkScore(segment) }))
      .sort((a, b) => b.score - a.score);

    const kept: string[] = [];
    let used = 0;
    for (const item of ranked) {
      const tokenCost = this.estimateTokens(item.segment);
      if (used + tokenCost <= targetTokens || kept.length < 3) {
        kept.push(item.segment);
        used += tokenCost;
      }
    }

    const ordered = segments.filter(segment => kept.includes(segment));
    const merged = ordered.join("\n");
    return merged
      .replace(/\n{3,}/g, "\n\n")
      .replace(/\s{2,}/g, " ")
      .replace(/\s+([,.;:!?])/g, "$1")
      .trim();
  }

  private segmentPrompt(prompt: string): string[] {
    return prompt
      .split(/\n+|(?<=[.!?])\s+(?=[A-Z0-9])/)
      .map(segment => segment.trim())
      .filter(segment => segment.length > 0);
  }

  private rtkScore(segment: string): number {
    const text = segment.toLowerCase();
    let score = 1;
    if (/\b(must|required|never|always|exactly|only)\b/.test(text)) score += 5;
    if (/\b(json|yaml|markdown|table|bullet|schema|format|output)\b/.test(text)) score += 4;
    if (/\b(example|acceptance criteria|success criteria|constraint|goal)\b/.test(text)) score += 3;
    if (/\b\d+(?:\.\d+)?%?\b/.test(text)) score += 4;
    if (/['"`]/.test(segment)) score += 3;
    if (/\b(optional|nice to have|if possible|maybe|perhaps)\b/.test(text)) score -= 2;
    score += Math.min(3, Math.floor(segment.length / 80));
    return score;
  }

  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  private preservesCriticalConstraints(original: string, candidate: string): boolean {
    const quoted = [...original.matchAll(/"([^"\n]{1,80})"|'([^'\n]{1,80})'/g)]
      .map(match => (match[1] ?? match[2] ?? "").trim().toLowerCase())
      .filter(Boolean);
    for (const fragment of quoted.slice(0, 10)) {
      if (!candidate.toLowerCase().includes(fragment)) return false;
    }

    const numbers = [...new Set((original.match(/\b\d+(?:\.\d+)?%?\b/g) ?? []).map(value => value.trim()))];
    for (const value of numbers.slice(0, 10)) {
      if (!candidate.includes(value)) return false;
    }

    return true;
  }

  private looksLikeCompletedArtifact(originalPrompt: string, candidate: string): boolean {
    const artifactSignals = /(^|\n)\s*(#{1,6}\s|```|<html|SELECT\s+.+\s+FROM|function\s+\w+\s*\(|class\s+\w+\s*\{|Dear\s+|Hi\s+|Hello\s+)/i;
    if (!artifactSignals.test(candidate)) return false;
    return !artifactSignals.test(originalPrompt);
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
