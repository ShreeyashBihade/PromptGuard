import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { describe, expect, it } from "vitest";
import { PromptPolicyPackService } from "./promptPolicyPackService";

describe("PromptPolicyPackService", () => {
  it("loads promptguard.policy-packs.json and renders policy pack guidance", () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "promptguard-policy-packs-"));
    fs.writeFileSync(path.join(workspaceRoot, "promptguard.policy-packs.json"), JSON.stringify({
      version: 1,
      name: "Enterprise packs",
      packs: [
        {
          id: "default",
          name: "Default guardrails",
          description: "Baseline prompt rules for the workspace",
          enabled: true,
          rules: [
            { id: "min-length", description: "Prompts must be long enough", minLength: 20 },
            { id: "no-passwords", description: "Prompts must not contain secrets", forbiddenTerms: ["password"] }
          ]
        }
      ]
    }, undefined, 2), "utf8");

    const service = new PromptPolicyPackService(workspaceRoot);
    const report = service.list();
    const markdown = service.renderMarkdown();

    expect(report.loaded).toBe(true);
    expect(report.packCount).toBe(1);
    expect(report.enabledPackCount).toBe(1);
    expect(markdown).toContain("PromptGuard Policy Packs");
    expect(markdown).toContain("Default guardrails");
    expect(markdown).toContain("Rules: 2");
  });
});