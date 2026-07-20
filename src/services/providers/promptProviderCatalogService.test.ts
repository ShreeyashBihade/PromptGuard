import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { describe, expect, it } from "vitest";
import { PromptProviderCatalogService } from "./promptProviderCatalogService";

describe("PromptProviderCatalogService", () => {
  it("loads promptguard.providers.json and renders provider guidance", () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "promptguard-providers-"));
    fs.writeFileSync(path.join(workspaceRoot, "promptguard.providers.json"), JSON.stringify({
      version: 1,
      providers: [
        { id: "groq", enabled: true, preferredModels: ["llama-3.3-70b-versatile"] },
        { id: "openai", enabled: false, preferredModels: ["gpt-4.1"] },
        { id: "claude", enabled: false },
        { id: "gemini", enabled: false }
      ]
    }, undefined, 2), "utf8");

    const service = new PromptProviderCatalogService(workspaceRoot);
    const report = service.listProfiles("Write a structured code review summary.");
    const markdown = service.renderMarkdown("Write a structured code review summary.");

    expect(report.loaded).toBe(true);
    expect(report.providers).toHaveLength(4);
    expect(report.providers[0]?.enabled).toBe(true);
    expect(markdown).toContain("PromptGuard Provider Catalog");
    expect(markdown).toContain("OpenAI");
    expect(markdown).toContain("Local recommendations");
  });
});