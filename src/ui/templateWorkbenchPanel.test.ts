import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TemplateWorkbenchReport } from "../services/templates/promptTemplateWorkbenchService";

const webview = { html: "" } as { html: string };
const panel = {
  webview,
  title: "",
  reveal: vi.fn(),
  onDidDispose: vi.fn()
};

vi.mock("vscode", () => ({
  ViewColumn: { Beside: 2 },
  window: {
    createWebviewPanel: vi.fn(() => panel)
  }
}));

import { TemplateWorkbenchPanel } from "./templateWorkbenchPanel";

describe("TemplateWorkbenchPanel", () => {
  beforeEach(() => {
    webview.html = "";
    panel.title = "";
    panel.reveal.mockClear();
  });

  it("renders scope summaries, reusable prefix suggestions, and snippet previews", () => {
    const templatePanel = new TemplateWorkbenchPanel();
    const report = {
      generatedAt: "2026-07-20T14:00:00.000Z",
      prompt: "Prompt",
      catalogSummary: [
        { scope: "workspace", templateCount: 1, name: "Workspace", sourcePath: "promptguard.templates.json" },
        { scope: "team", templateCount: 1, name: "Team", sourcePath: ".promptguard/templates.team.json" },
        { scope: "global", templateCount: 1, name: "Global", sourcePath: "promptguard.templates.json" }
      ],
      templateCount: 3,
      suggestionCount: 1,
      method: "lightweight",
      catalogTemplates: [
        { id: "1", name: "Summary", description: "A reusable summary prompt", content: "Task: summarize {{topic}}.", tags: ["summary"], scope: "workspace", sourcePath: "promptguard.templates.json", variables: [{ name: "topic" }] }
      ],
      prefixSuggestions: [
        { prefix: "You are a precise editor", occurrences: 2, currentOccurrences: 2, historyOccurrences: 0, estimatedSavingsTokens: 8, templatePreview: "You are a precise editor\n\n", snippetBody: "You are a precise editor\n\n${1:details}", variables: ["details"], examples: ["You are a precise editor. Write..."], reason: "Repeated prefix" }
      ]
    } satisfies TemplateWorkbenchReport;

    templatePanel.show(report);

    expect(panel.title).toContain("Prompt Templates");
    expect(webview.html).toContain("workspace templates");
    expect(webview.html).toContain("Reusable prefix suggestions");
    expect(webview.html).toContain("Snippet expansion");
  });
});