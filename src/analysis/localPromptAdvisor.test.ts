import { describe, expect, it } from "vitest";
import { LocalPromptAdvisor } from "./localPromptAdvisor";

describe("LocalPromptAdvisor", () => {
  it("personalizes suggestions from privacy-first learning metadata", () => {
    const advisor = new LocalPromptAdvisor();
    const insights = advisor.build(
      "Summarize the design decision and provide a checklist.",
      "local-only",
      {
        loaded: true,
        signalCount: 4,
        acceptedOptimizationCount: 3,
        rejectedOptimizationCount: 1,
        issueCategories: { constraints: 5, formatting: 2 },
        sourceCounts: { optimize: 3, analyze: 1 },
        averageScore: 78,
        averageTokenSavings: 14,
        averageTimeSavedMs: 220,
        totalTokenSavings: 42,
        totalTimeSavedMs: 660
      }
    );

    expect(insights.bestPractices.join(" ")).toContain("concise rewrites");
    expect(insights.bestPractices.join(" ")).toContain("explicit constraints");
    expect(insights.recommendations[0]?.rationale).toContain("saved tokens");
  });
});