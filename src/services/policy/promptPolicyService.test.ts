import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { describe, expect, it } from "vitest";
import { PromptPolicyService } from "./promptPolicyService";

describe("PromptPolicyService", () => {
  it("loads promptguard.json and validates prompt constraints", () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "promptguard-policy-"));
    fs.writeFileSync(path.join(workspaceRoot, "promptguard.json"), JSON.stringify({
      version: 1,
      name: "Test policy",
      rules: [
        {
          id: "min-length",
          description: "Prompt must be long enough",
          minLength: 40,
          requiredTerms: ["summary"],
          forbiddenTerms: ["password"]
        }
      ]
    }, undefined, 2), "utf8");

    const service = new PromptPolicyService(workspaceRoot);
    const report = service.validate("Write a short summary without secrets.");

    expect(report.loaded).toBe(true);
    expect(report.ruleCount).toBe(1);
    expect(report.violations.length).toBeGreaterThan(0);
  });

  it("loads the simplified promptguard.json policy shape and validates built-in rules", () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "promptguard-policy-simple-"));
    fs.writeFileSync(path.join(workspaceRoot, "promptguard.json"), JSON.stringify({
      maxTokens: 10,
      requireOutput: true,
      forbidSecrets: true,
      requireConstraints: true
    }, undefined, 2), "utf8");

    const service = new PromptPolicyService(workspaceRoot);
    const report = service.validate("Write a prompt with an API key: sk-test-12345.");

    expect(report.loaded).toBe(true);
    expect(report.ruleCount).toBe(4);
    expect(report.violations.map(violation => violation.ruleId)).toEqual(expect.arrayContaining([
      "policy:maxTokens",
      "policy:requireOutput",
      "policy:forbidSecrets",
      "policy:requireConstraints"
    ]));
  });
});
