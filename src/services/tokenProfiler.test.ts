import { describe, expect, it } from "vitest";
import { TokenProfilerService } from "./tokenProfiler";

describe("TokenProfilerService", () => {
  it("profiles token counts by section and computes summary costs", () => {
    const profiler = new TokenProfilerService();
    const report = profiler.profile({
      text: `You are a senior product manager.

Task: create a launch checklist.

Constraints:
- Keep it under 250 words
- Include exactly 5 acceptance criteria

Output format: Markdown.`,
      uri: "file:///test.md",
      version: 1,
      pricing: { inputPerMillionUsd: 1, outputPerMillionUsd: 2 }
    });

    expect(report.totalTokens).toBeGreaterThan(0);
    expect(report.sections.length).toBeGreaterThan(0);
    expect(report.estimatedInputCostUsd).toBeGreaterThan(0);
    expect(report.estimatedOutputCostUsd).toBeGreaterThan(0);
    expect(report.latencyMs).toBeGreaterThan(0);
    expect(report.mostExpensiveSection?.label).toBeDefined();
  });

  it("reuses cached section profiles for unchanged content", () => {
    const profiler = new TokenProfilerService();
    const first = profiler.profile({
      text: `Role: you are an editor.

Task: rewrite this prompt.

Output format: Markdown.`,
      uri: "file:///cache.md",
      version: 1
    });
    const second = profiler.profile({
      text: `Role: you are an editor.

Task: rewrite this prompt.

Output format: Markdown.`,
      uri: "file:///cache.md",
      version: 2
    });

    expect(first.totalTokens).toBe(second.totalTokens);
    expect(second.cacheHits).toBeGreaterThan(0);
  });
});
