import { describe, expect, it } from "vitest";
import {
  PromptOptimizationCompressionStage,
  PromptOptimizationContextStage,
  PromptOptimizationCostStage,
  PromptOptimizationDiffStage,
  PromptOptimizationDuplicateStage,
  PromptOptimizationLintStage,
  PromptOptimizationOutputStage,
  PromptOptimizationParseStage,
  PromptOptimizationPipeline
} from "./optimizationPipeline";

const prompt = `
Role: You are a precise editor.

Task: Rewrite the prompt to remove repeated ideas and keep it concise.

Background: This product launched in 2021, has a long history, and includes unrelated details that are not needed.

Task: Rewrite the prompt to remove repeated ideas and keep it concise.

Output format: markdown.
`;

describe("PromptOptimizationParseStage", () => {
  it("parses prompts into AST nodes", () => {
    const stage = new PromptOptimizationParseStage();
    const ast = stage.parse(prompt);

    expect(ast.rawText).toContain("precise editor");
    expect(ast.children.length).toBeGreaterThan(0);
  });
});

describe("PromptOptimizationLintStage", () => {
  it("returns provided lint issues when they are already available", () => {
    const stage = new PromptOptimizationLintStage();
    const issues = stage.lint(prompt, [{ id: "1", ruleId: "missing-role", title: "Missing role", description: "Role", severity: "warning", confidence: 0.8, category: "context", suggestedFix: "Add role", estimatedTokenSavings: 4, estimatedCostSavings: 0.001 }]);

    expect(issues).toHaveLength(1);
    expect(issues[0]?.ruleId).toBe("missing-role");
  });
});

describe("PromptOptimizationDuplicateStage", () => {
  it("detects duplicated blocks", () => {
    const stage = new PromptOptimizationDuplicateStage();
    const report = stage.detect(prompt);

    expect(report.matchCount).toBeGreaterThan(0);
    expect(report.matches[0]?.potentialSavingsTokens ?? 0).toBeGreaterThan(0);
  });
});

describe("PromptOptimizationCompressionStage", () => {
  it("applies deterministic compression rules", () => {
    const stage = new PromptOptimizationCompressionStage();
    const preview = stage.compress(`Please make sure you should keep it concise.
You should keep it concise.
Constraints: keep it short.
Constraints: keep it short.`);

    expect(preview.optimizedPrompt).toContain("Must keep it concise.");
    expect(preview.steps.length).toBeGreaterThan(0);
  });
});

describe("PromptOptimizationContextStage", () => {
  it("finds removable context blocks", () => {
    const stage = new PromptOptimizationContextStage();
    const report = stage.optimize(prompt);

    expect(report.suggestionCount).toBeGreaterThan(0);
    expect(report.suggestions[0]?.removableTokens ?? 0).toBeGreaterThan(0);
  });
});

describe("PromptOptimizationCostStage", () => {
  it("analyzes original and optimized cost deltas", () => {
    const stage = new PromptOptimizationCostStage();
    const result = stage.analyze(prompt, "Task: rewrite the prompt.", []);

    expect(result.original.inputTokens).toBeGreaterThan(0);
    expect(result.optimized.inputTokens).toBeGreaterThan(0);
    expect(result.savingsTokens).toBeGreaterThanOrEqual(0);
  });
});

describe("PromptOptimizationDiffStage", () => {
  it("returns a diff view for the optimized prompt", () => {
    const stage = new PromptOptimizationDiffStage();
    const diff = stage.generate(prompt, {
      optimizedPrompt: "Task: rewrite the prompt.",
      reason: "demo",
      confidence: 0.8,
      estimatedTokenSavings: 8,
      diff: "- old\n+ new",
      diffView: { totalTokenSavings: 8, totalCostSavingsUsd: 0.000001, changes: [], acceptedOptimizedPrompt: "Task: rewrite the prompt." },
      steps: []
    });

    expect(diff.diff).toContain("-");
    expect(diff.diffView.acceptedOptimizedPrompt).toContain("rewrite");
  });
});

describe("PromptOptimizationOutputStage", () => {
  it("assembles the final optimization suggestion", () => {
    const stage = new PromptOptimizationOutputStage();
    const suggestion = stage.build({
      issues: [{ id: "1", ruleId: "missing-role", title: "Missing role", description: "Role", severity: "warning", confidence: 0.8, category: "context", suggestedFix: "Add role", estimatedTokenSavings: 4, estimatedCostSavings: 0.001 }],
      duplicateReport: { generatedAt: new Date().toISOString(), prompt, blockCount: 3, matchCount: 1, method: "lightweight", matches: [] },
      compressionPreview: {
        optimizedPrompt: "Task: rewrite the prompt.",
        reason: "Compressed prompt.",
        confidence: 0.8,
        estimatedTokenSavings: 8,
        diff: "- old\n+ new",
        diffView: { totalTokenSavings: 8, totalCostSavingsUsd: 0.000001, changes: [], acceptedOptimizedPrompt: "Task: rewrite the prompt." },
        steps: []
      },
      contextReport: { generatedAt: new Date().toISOString(), prompt, blockCount: 3, suggestionCount: 1, method: "lightweight", taskSummary: "Task", suggestions: [] },
      costAnalysis: { original: { inputTokens: 10, outputTokens: 15, estimatedCostUsd: 0.0001, estimatedLatencyMs: 100, wastedTokens: 0, potentialSavingsUsd: 0, pricingSource: "estimated" }, optimized: { inputTokens: 6, outputTokens: 15, estimatedCostUsd: 0.00008, estimatedLatencyMs: 90, wastedTokens: 0, potentialSavingsUsd: 0, pricingSource: "estimated" }, savingsUsd: 0.00002, savingsTokens: 4, latencyReductionMs: 10 },
      diff: { diff: "- old\n+ new", diffView: { totalTokenSavings: 8, totalCostSavingsUsd: 0.000001, changes: [], acceptedOptimizedPrompt: "Task: rewrite the prompt." } }
    });

    expect(suggestion.title).toBe("Add structure and guardrails");
    expect(suggestion.preview).toContain("rewrite the prompt");
    expect(suggestion.reason).toContain("Estimated cost savings");
  });
});

describe("PromptOptimizationPipeline", () => {
  it("runs the full optimization pipeline", () => {
    const pipeline = new PromptOptimizationPipeline();
    const result = pipeline.run({
      prompt,
      issues: [{ id: "1", ruleId: "missing-output-format", title: "Missing output format", description: "Output", severity: "warning", confidence: 0.8, category: "formatting", suggestedFix: "Add output format", estimatedTokenSavings: 4, estimatedCostSavings: 0.001 }]
    });

    expect(result.ast.children.length).toBeGreaterThan(0);
    expect(result.duplicateReport.matchCount).toBeGreaterThanOrEqual(0);
    expect(result.contextReport.suggestionCount).toBeGreaterThanOrEqual(0);
    expect(result.costAnalysis.original.inputTokens).toBeGreaterThan(0);
    expect(result.suggestion.preview).toBe(result.compressionPreview.optimizedPrompt);
  });
});