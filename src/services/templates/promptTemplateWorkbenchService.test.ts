import { describe, expect, it } from "vitest";
import { HistoryStore } from "../../history/historyStore";
import { PromptTemplateService } from "./promptTemplateService";
import { PromptTemplateWorkbenchService } from "./promptTemplateWorkbenchService";

describe("PromptTemplateWorkbenchService", () => {
  it("detects repeated prefixes and builds a reusable template preview", () => {
    const templateService = new PromptTemplateService(undefined, undefined);
    const workbench = new PromptTemplateWorkbenchService(templateService);
    const history = [
      { id: "1", timestamp: "2026-07-20T10:00:00.000Z", originalPrompt: "You are a precise editor. Write a concise summary of the report.", optimizedPrompt: "", score: 0, improvement: 0, estimatedSavings: 0 },
      { id: "2", timestamp: "2026-07-20T11:00:00.000Z", originalPrompt: "You are a precise editor. Write a concise summary of the article.", optimizedPrompt: "", score: 0, improvement: 0, estimatedSavings: 0 }
    ] as const;

    const report = workbench.review(`
You are a precise editor. Write a concise summary of the report.

You are a precise editor. Write a concise summary of the article.
`, history);

    expect(report.method).toBe("lightweight");
    expect(report.suggestionCount).toBeGreaterThan(0);
    expect(report.prefixSuggestions[0]?.prefix).toContain("You are a precise editor");
    expect(report.prefixSuggestions[0]?.templatePreview).toContain("You are a precise editor");
    expect(report.prefixSuggestions[0]?.snippetBody).toContain("${1:details}");
  });
});