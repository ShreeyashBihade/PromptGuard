import { describe, expect, it } from "vitest";
import { PromptAuditExportService } from "./promptAuditExportService";

describe("PromptAuditExportService", () => {
  it("builds an audit report with team analytics and workspace controls", () => {
    const service = new PromptAuditExportService();
    const report = service.build({
      workspaceName: "PromptGuard",
      history: [
        { id: "1", timestamp: "2026-07-20T10:00:00.000Z", originalPrompt: "Write a summary of the roadmap.", optimizedPrompt: "Write a summary.", score: 82, improvement: 18, estimatedSavings: 0.0012 },
        { id: "2", timestamp: "2026-07-20T11:00:00.000Z", originalPrompt: "Draft policy guidance for prompts.", optimizedPrompt: "Draft policy guidance.", score: 74, improvement: 26, estimatedSavings: 0.0008 }
      ],
      ledger: {
        version: 1,
        updatedAt: "2026-07-20T11:05:00.000Z",
        totals: {
          projectName: "PromptGuard",
          totalEntries: 2,
          totalInputTokens: 240,
          totalOutputTokens: 180,
          totalReducedTokens: 60,
          totalEstimatedSavingsUsd: 0.002,
          averageReductionPercent: 25
        },
        entries: [
          { id: "entry-1", timestamp: "2026-07-20T10:00:00.000Z", source: "editor", projectName: "PromptGuard", inputPrompt: "Write a summary of the roadmap.", outputPrompt: "Write a summary.", inputTokens: 120, outputTokens: 90, reducedTokens: 30, reductionPercent: 25, estimatedSavingsUsd: 0.001, score: 82 },
          { id: "entry-2", timestamp: "2026-07-20T11:00:00.000Z", source: "local-chat", projectName: "PromptGuard", inputPrompt: "Draft policy guidance for prompts.", outputPrompt: "Draft policy guidance.", inputTokens: 120, outputTokens: 90, reducedTokens: 30, reductionPercent: 25, estimatedSavingsUsd: 0.001, score: 74 }
        ]
      },
      policy: { version: 1, name: "Policy pack", rules: [{ id: "r1", description: "Keep prompts concise" }] },
      budget: { version: 1, name: "Budget pack", maxTokens: 500 },
      templateCount: 3,
      learning: {
        loaded: true,
        signalCount: 4,
        acceptedOptimizationCount: 2,
        rejectedOptimizationCount: 1,
        issueCategories: { context: 2 },
        sourceCounts: { analyze: 2, template: 2 },
        averageScore: 78,
        averageTokenSavings: 12,
        averageTimeSavedMs: 180,
        totalTokenSavings: 24,
        totalTimeSavedMs: 360
      },
      benchmarks: { loaded: true, suiteCount: 1, caseCount: 2, passedCount: 1, failedCount: 1, averageScore: 81, suites: [] }
    });

    const markdown = service.renderMarkdown(report);

    expect(report.analytics.promptCount).toBe(2);
    expect(report.analytics.totalReducedTokens).toBe(60);
    expect(report.policyRuleCount).toBe(1);
    expect(report.learningSignals).toBe(4);
    expect(markdown).toContain("PromptGuard Audit Export");
    expect(markdown).toContain("Team Analytics");
    expect(markdown).toContain("Benchmark suites: 1");
  });
});