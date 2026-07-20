import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DuplicateDetectionReport } from "../services/duplicates/promptDuplicateDetectionService";

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

import { DuplicateDetectionPanel } from "./duplicateDetectionPanel";

describe("DuplicateDetectionPanel", () => {
  beforeEach(() => {
    webview.html = "";
    panel.title = "";
    panel.reveal.mockClear();
  });

  it("renders similarity percent, savings, and merge suggestion", () => {
    const detectionPanel = new DuplicateDetectionPanel();
    const report = {
      generatedAt: "2026-07-20T14:00:00.000Z",
      prompt: "Task prompt",
      blockCount: 2,
      matchCount: 1,
      method: "lightweight",
      matches: [
        {
          left: { kind: "task", label: "Task", text: "Rewrite the prompt to remove repeated ideas.", tokenCount: 10, lineStart: 1, lineEnd: 2 },
          right: { kind: "task", label: "Task", text: "Rewrite the prompt so repeated ideas are removed.", tokenCount: 11, lineStart: 3, lineEnd: 4 },
          similarityPercent: 84,
          potentialSavingsTokens: 6,
          mergeSuggestion: "Merge the repeated ideas into one task.",
          reason: "Shared concepts: rewrite, prompt, repeated, ideas. Lightweight similarity score: 84%.",
          method: "lightweight"
        }
      ]
    } satisfies DuplicateDetectionReport;

    detectionPanel.show(report);

    expect(panel.title).toContain("Duplicate Detection");
    expect(webview.html).toContain("Similarity 84%");
    expect(webview.html).toContain("Potential savings 6 tokens");
    expect(webview.html).toContain("Merge suggestion");
  });
});