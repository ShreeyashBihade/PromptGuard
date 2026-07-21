import { PromptAnalyzer } from "../analysis/promptAnalyzer";
import { PromptAstParser } from "../analysis/promptAstParser";
import { PromptAstDocument } from "../analysis/promptAst";
import { CostEstimator } from "../cost/costEstimator";
import { PromptContextOptimizerService, ContextOptimizationReport } from "../services/context/promptContextOptimizerService";
import { PromptDuplicateDetectionService, DuplicateDetectionReport } from "../services/duplicates/promptDuplicateDetectionService";
import { OptimizationDiffView, OptimizationSuggestion, PromptIssue, PricingProfile, ModelIdentity } from "../types";
import { CompressionPreview, PromptCompressionEngine } from "./promptCompressionEngine";

export interface PromptOptimizationCostAnalysis {
  readonly original: ReturnType<CostEstimator["estimate"]>;
  readonly optimized: ReturnType<CostEstimator["estimate"]>;
  readonly savingsUsd: number;
  readonly savingsTokens: number;
  readonly latencyReductionMs: number;
}

export interface PromptOptimizationDiffResult {
  readonly diff: string;
  readonly diffView: OptimizationDiffView;
}

export interface PromptOptimizationPipelineResult {
  readonly prompt: string;
  readonly ast: PromptAstDocument;
  readonly issues: readonly PromptIssue[];
  readonly duplicateReport: DuplicateDetectionReport;
  readonly compressionPreview: CompressionPreview;
  readonly contextReport: ContextOptimizationReport;
  readonly costAnalysis: PromptOptimizationCostAnalysis;
  readonly diff: PromptOptimizationDiffResult;
  readonly suggestion: OptimizationSuggestion;
}

export interface PromptOptimizationPipelineInput {
  readonly prompt: string;
  readonly issues: readonly PromptIssue[];
  readonly model?: ModelIdentity;
  readonly pricing?: PricingProfile[];
}

export class PromptOptimizationParseStage {
  private readonly parser = new PromptAstParser();

  parse(prompt: string): PromptAstDocument {
    return this.parser.parse(prompt);
  }
}

export class PromptOptimizationLintStage {
  private readonly analyzer = new PromptAnalyzer();

  lint(prompt: string, issues: readonly PromptIssue[] = []): readonly PromptIssue[] {
    return issues.length ? [...issues] : this.analyzer.analyze(prompt).issues;
  }
}

export class PromptOptimizationDuplicateStage {
  private readonly duplicateDetection = new PromptDuplicateDetectionService();

  detect(prompt: string): DuplicateDetectionReport {
    return this.duplicateDetection.detect(prompt);
  }
}

export class PromptOptimizationCompressionStage {
  private readonly compressionEngine = new PromptCompressionEngine();

  compress(prompt: string): CompressionPreview {
    return this.compressionEngine.compress(prompt);
  }
}

export class PromptOptimizationContextStage {
  private readonly contextOptimizer = new PromptContextOptimizerService();

  optimize(prompt: string): ContextOptimizationReport {
    return this.contextOptimizer.optimize(prompt);
  }
}

export class PromptOptimizationCostStage {
  private readonly costEstimator = new CostEstimator();

  analyze(prompt: string, optimizedPrompt: string, issues: readonly PromptIssue[], model?: ModelIdentity, pricing?: PricingProfile[]): PromptOptimizationCostAnalysis {
    const original = this.costEstimator.estimate(prompt, [...issues], { model, pricing });
    const optimized = this.costEstimator.estimate(optimizedPrompt, [...issues], { model, pricing });
    return {
      original,
      optimized,
      savingsUsd: Math.max(0, (original.estimatedCostUsd ?? 0) - (optimized.estimatedCostUsd ?? 0)),
      savingsTokens: Math.max(0, original.inputTokens - optimized.inputTokens),
      latencyReductionMs: Math.max(0, original.estimatedLatencyMs - optimized.estimatedLatencyMs)
    };
  }
}

export class PromptOptimizationDiffStage {
  generate(originalPrompt: string, preview: CompressionPreview): PromptOptimizationDiffResult {
    return {
      diff: preview.diff || this.buildFallbackDiff(originalPrompt, preview.optimizedPrompt),
      diffView: preview.diffView
    };
  }

  private buildFallbackDiff(originalPrompt: string, optimizedPrompt: string): string {
    const originalLines = originalPrompt.split(/\r?\n/);
    const optimizedLines = optimizedPrompt.split(/\r?\n/);
    const maxLength = Math.max(originalLines.length, optimizedLines.length);
    const diffLines: string[] = [];

    for (let index = 0; index < maxLength; index += 1) {
      const originalLine = originalLines[index];
      const optimizedLine = optimizedLines[index];
      if (originalLine === optimizedLine) {
        if (originalLine !== undefined) {
          diffLines.push(`  ${originalLine}`);
        }
        continue;
      }
      if (originalLine !== undefined) {
        diffLines.push(`- ${originalLine}`);
      }
      if (optimizedLine !== undefined) {
        diffLines.push(`+ ${optimizedLine}`);
      }
    }

    return diffLines.join("\n");
  }
}

export class PromptOptimizationOutputStage {
  build(input: {
    readonly issues: readonly PromptIssue[];
    readonly duplicateReport: DuplicateDetectionReport;
    readonly compressionPreview: CompressionPreview;
    readonly contextReport: ContextOptimizationReport;
    readonly costAnalysis: PromptOptimizationCostAnalysis;
    readonly diff: PromptOptimizationDiffResult;
  }): OptimizationSuggestion {
    const guardrailIssues = new Set(input.issues.map(issue => issue.ruleId));
    const hasGuardrails = guardrailIssues.has("missing-role") || guardrailIssues.has("missing-constraints") || guardrailIssues.has("missing-output-format");
    const title = hasGuardrails ? "Add structure and guardrails" : "Tighten wording";
    const summaryParts = [
      input.compressionPreview.reason,
      input.duplicateReport.matchCount ? `${input.duplicateReport.matchCount} duplicate block match${input.duplicateReport.matchCount === 1 ? "" : "es"} reviewed.` : undefined,
      input.contextReport.suggestionCount ? `${input.contextReport.suggestionCount} context block${input.contextReport.suggestionCount === 1 ? "" : "s"} marked as removable.` : undefined,
      input.costAnalysis.savingsUsd > 0 ? `Estimated cost savings ${this.money(input.costAnalysis.savingsUsd)}.` : undefined
    ].filter(Boolean).join(" ");

    return {
      title,
      reason: summaryParts || "Deterministic optimization completed.",
      preview: input.compressionPreview.optimizedPrompt,
      optimizedPrompt: input.compressionPreview.optimizedPrompt,
      issuesAddressed: input.issues.slice(0, 5).map(issue => issue.ruleId),
      estimatedTokenSavings: input.compressionPreview.estimatedTokenSavings,
      confidence: input.compressionPreview.confidence,
      diff: input.diff.diff,
      diffView: input.diff.diffView,
      compressionSteps: input.compressionPreview.steps
    };
  }

  private money(value: number): string {
    return `$${value.toFixed(6)}`;
  }
}

export class PromptOptimizationPipeline {
  private readonly parseStage = new PromptOptimizationParseStage();
  private readonly lintStage = new PromptOptimizationLintStage();
  private readonly duplicateStage = new PromptOptimizationDuplicateStage();
  private readonly compressionStage = new PromptOptimizationCompressionStage();
  private readonly contextStage = new PromptOptimizationContextStage();
  private readonly costStage = new PromptOptimizationCostStage();
  private readonly diffStage = new PromptOptimizationDiffStage();
  private readonly outputStage = new PromptOptimizationOutputStage();

  run(input: PromptOptimizationPipelineInput): PromptOptimizationPipelineResult {
    const ast = this.parseStage.parse(input.prompt);
    const lintIssues = this.lintStage.lint(ast.rawText, input.issues);
    const duplicateReport = this.duplicateStage.detect(ast.rawText);
    const compressionPreview = this.compressionStage.compress(ast.rawText);
    const contextReport = this.contextStage.optimize(ast.rawText);
    const costAnalysis = this.costStage.analyze(ast.rawText, compressionPreview.optimizedPrompt, lintIssues, input.model, input.pricing);
    const diff = this.diffStage.generate(ast.rawText, compressionPreview);
    const suggestion = this.outputStage.build({ issues: lintIssues, duplicateReport, compressionPreview, contextReport, costAnalysis, diff });

    return {
      prompt: ast.rawText,
      ast,
      issues: lintIssues,
      duplicateReport,
      compressionPreview,
      contextReport,
      costAnalysis,
      diff,
      suggestion
    };
  }
}
