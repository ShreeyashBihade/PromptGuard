import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { describe, expect, it } from "vitest";
import { PromptBenchmarkService } from "./promptBenchmarkService";

describe("PromptBenchmarkService", () => {
  it("loads promptguard.benchmarks.json and evaluates suites", () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "promptguard-benchmarks-"));
    fs.writeFileSync(path.join(workspaceRoot, "promptguard.benchmarks.json"), JSON.stringify({
      version: 1,
      name: "Regression benchmarks",
      suites: [
        {
          id: "basic",
          name: "Basic scoring",
          cases: [
            {
              id: "pass-case",
              name: "Permissive benchmark",
              prompt: "Write a concise summary of the project goals.",
              criteria: [
                { id: "allow-anything", description: "Accept any reasonable analysis result", maxIssueCount: 50, minScore: 0 }
              ]
            },
            {
              id: "fail-case",
              name: "Impossible score threshold",
              prompt: "Write a concise summary of the project goals.",
              criteria: [
                { id: "impossible-score", description: "Force a failure for regression coverage", minScore: 101 }
              ]
            }
          ]
        }
      ]
    }, undefined, 2), "utf8");

    const service = new PromptBenchmarkService(workspaceRoot);
    const report = service.run();

    expect(report.loaded).toBe(true);
    expect(report.suiteCount).toBe(1);
    expect(report.caseCount).toBe(2);
    expect(report.passedCount).toBe(1);
    expect(report.failedCount).toBe(1);
    expect(report.suites[0]?.cases[0]?.passed).toBe(true);
    expect(report.suites[0]?.cases[1]?.passed).toBe(false);
  });
});