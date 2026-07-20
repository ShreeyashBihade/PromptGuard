import { describe, expect, it } from "vitest";
import { PromptCostSimulatorService } from "./promptCostSimulatorService";

describe("PromptCostSimulatorService", () => {
  it("compares providers and projects usage with optimization savings", () => {
    const service = new PromptCostSimulatorService();
    const report = service.simulate(
      ["Summarize the roadmap.", "Summarize the roadmap.", "Summarize the roadmap."].join("\n"),
      [],
      [{ provider: "groq", displayName: "Groq", inputPerMillionUsd: 0.2, outputPerMillionUsd: 0.6, latencyMs: 180 }],
      24
    );

    expect(report.monthlyRuns).toBe(24);
    expect(report.yearlyRuns).toBe(288);
    expect(report.providerComparisons).toHaveLength(1);
    expect(report.providerComparisons[0]?.displayName).toBe("Groq");
    expect(report.providerComparisons[0]?.monthlyRuns).toBe(24);
    expect(report.providerComparisons[0]?.yearlyRuns).toBe(288);
    expect(report.providerComparisons[0]?.savingsAfterOptimizationMonthlyUsd ?? 0).toBeGreaterThanOrEqual(0);
    expect(report.optimizationSavingsTokens).toBeGreaterThanOrEqual(0);
    expect(report.optimizationSavingsUsd).toBeGreaterThanOrEqual(0);
  });
});