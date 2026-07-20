import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { describe, expect, it } from "vitest";
import { PromptProviderRegistryService } from "./promptProviderRegistryService";

describe("PromptProviderRegistryService", () => {
  it("updates promptguard.providers.json opt-in state", async () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "promptguard-provider-registry-"));
    const service = new PromptProviderRegistryService(workspaceRoot);

    await service.setEnabled("openai", true, ["gpt-4.1"]);
    await service.setEnabled("claude", false);

    const report = service.list();
    expect(report.loaded).toBe(true);
    expect(report.providers.some(provider => provider.id === "openai" && provider.enabled)).toBe(true);
    expect(report.providers.some(provider => provider.id === "claude" && !provider.enabled)).toBe(true);
    expect(fs.readFileSync(path.join(workspaceRoot, "promptguard.providers.json"), "utf8")).toContain("openai");
  });
});