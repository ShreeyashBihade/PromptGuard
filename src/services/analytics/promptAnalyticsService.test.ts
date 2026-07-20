import { describe, expect, it } from "vitest";
import { PromptAnalyticsService } from "./promptAnalyticsService";

describe("PromptAnalyticsService", () => {
  it("aggregates average prompt metrics and recent samples", () => {
    const service = new PromptAnalyticsService();
    const report = service.build([
      {
        id: "1",
        timestamp: "2026-07-01T10:00:00.000Z",
        originalPrompt: "You are a helpful assistant. Summarize this proposal clearly and briefly.",
        optimizedPrompt: "Summarize the proposal clearly.",
        score: 78,
        improvement: 12,
        estimatedSavings: 0.0012
      },
      {
        id: "2",
        timestamp: "2026-07-15T10:00:00.000Z",
        originalPrompt: "You are a helpful assistant. Summarize this proposal clearly and briefly. Repeat the instructions if needed.",
        optimizedPrompt: "Summarize the proposal clearly.",
        score: 84,
        improvement: 16,
        estimatedSavings: 0.0016
      }
    ]);

    expect(report.sampleCount).toBe(2);
    expect(report.averageTokens).toBeGreaterThan(0);
    expect(report.averageAmbiguity).toBeGreaterThanOrEqual(0);
    expect(report.averageRedundancy).toBeGreaterThanOrEqual(0);
    expect(report.averageQuality).toBe(81);
    expect(report.averageOptimizationSavingsUsd).toBeCloseTo(0.0014, 4);
    expect(report.averageCostUsd).toBeGreaterThan(0);
    expect(report.recentSamples).toHaveLength(2);
    expect(report.recentSamples[0]?.label).toContain("Prompt 2");
  });
});