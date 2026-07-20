import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { describe, expect, it } from "vitest";
import { PromptHandoffService } from "./promptHandoffService";

describe("PromptHandoffService", () => {
  it("exports browser-friendly prompt handoff artifacts", async () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "promptguard-handoff-"));
    const service = new PromptHandoffService();
    const report = await service.export(workspaceRoot, {
      generatedAt: "2026-07-20T14:00:00.000Z",
      title: "PromptGuard Handoff",
      prompt: "Write a prompt for a browser extension.",
      source: "PromptGuard",
      target: "browser"
    });

    expect(report).toBeDefined();
    expect(fs.existsSync(report!.jsonPath)).toBe(true);
    expect(fs.existsSync(report!.htmlPath)).toBe(true);
    expect(fs.readFileSync(report!.jsonPath, "utf8")).toContain("browser");
    expect(fs.readFileSync(report!.jsonPath, "utf8")).toContain("nextSteps");
    expect(fs.readFileSync(report!.htmlPath, "utf8")).toContain("PromptGuard Handoff");
    expect(fs.readFileSync(report!.htmlPath, "utf8")).toContain("Browser extension bootstrap");
    expect(report!.artifact.nextSteps?.length).toBeGreaterThan(0);
  });
});