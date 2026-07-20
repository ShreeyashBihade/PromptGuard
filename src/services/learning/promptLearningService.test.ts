import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { describe, expect, it } from "vitest";
import { PromptLearningService } from "./promptLearningService";

describe("PromptLearningService", () => {
  it("records prompt-only learning signals and summarizes them", () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "promptguard-learning-"));
    const service = new PromptLearningService(workspaceRoot);

    service.recordOptimization("refine-minimize", [
      { id: "1", ruleId: "missing-role", title: "Role missing", description: "Role", severity: "warning", confidence: 0.9, category: "context", suggestedFix: "Add role", estimatedTokenSavings: 5, estimatedCostSavings: 0.001 }
    ], 12, 180, "accepted");
    service.recordOptimization("optimize", [], 0, 0, "rejected");
    service.recordTemplate(["analysis", "summary"]);

    const summary = service.summarize();

    expect(summary.loaded).toBe(true);
    expect(summary.signalCount).toBe(3);
    expect(summary.acceptedOptimizationCount).toBe(1);
    expect(summary.rejectedOptimizationCount).toBe(1);
    expect(summary.sourceCounts["refine-minimize"]).toBe(1);
    expect(summary.sourceCounts.optimize).toBe(1);
    expect(summary.sourceCounts.template).toBe(1);
    expect(summary.totalTokenSavings).toBe(12);
    expect(summary.totalTimeSavedMs).toBe(180);
  });
});
