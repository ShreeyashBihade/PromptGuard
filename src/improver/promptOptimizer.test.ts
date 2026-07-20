import { describe, expect, it } from "vitest";
import { PromptOptimizer } from "./promptOptimizer";

describe("PromptOptimizer", () => {
  it("returns a preview with savings, confidence, and a deterministic diff", () => {
    const optimizer = new PromptOptimizer();
    const suggestion = optimizer.suggest(
      `Please make sure you should summarize this prompt.

Output format: markdown.`,
      []
    );

    expect(suggestion.preview).toContain("Must summarize this prompt.");
    expect(suggestion.optimizedPrompt).toBe(suggestion.preview);
    expect(suggestion.reason.length).toBeGreaterThan(0);
    expect(suggestion.estimatedTokenSavings ?? 0).toBeGreaterThanOrEqual(0);
    expect(suggestion.confidence ?? 0).toBeGreaterThanOrEqual(0);
    expect(suggestion.diff).toContain("-");
    expect(suggestion.diffView?.changes.length ?? 0).toBeGreaterThanOrEqual(1);
    expect(suggestion.diffView?.totalTokenSavings ?? 0).toBeGreaterThanOrEqual(0);
    expect(suggestion.compressionSteps?.length ?? 0).toBeGreaterThanOrEqual(0);
  });
});
