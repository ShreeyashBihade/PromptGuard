import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { describe, expect, it } from "vitest";
import { PromptBudgetService } from "./promptBudgetService";

describe("PromptBudgetService", () => {
  it("loads promptguard.budget.json and flags budget overruns", () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "promptguard-budget-"));
    fs.writeFileSync(path.join(workspaceRoot, "promptguard.budget.json"), JSON.stringify({
      version: 1,
      name: "Test budget",
      maxTokens: 5,
      maxInputCostUsd: 0.000001,
      maxOutputCostUsd: 0.000001,
      maxLatencyMs: 100
    }, undefined, 2), "utf8");

    const service = new PromptBudgetService(workspaceRoot);
    const report = service.validate("Write a detailed explanation of token budgets and validation behavior.");

    expect(report.loaded).toBe(true);
    expect(report.violationCount).toBeGreaterThan(0);
    expect(report.violations.some(violation => violation.field === "maxTokens")).toBe(true);
    expect(report.violations[0]?.suggestedFix.length ?? 0).toBeGreaterThan(0);
    expect(["promptguard.optimize", "promptguard.openTokenProfiler"]).toContain(report.violations[0]?.recommendedCommand);
  });
});
