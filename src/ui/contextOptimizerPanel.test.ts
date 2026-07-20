import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ContextOptimizationReport } from "../services/context/promptContextOptimizerService";

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

import { ContextOptimizerPanel } from "./contextOptimizerPanel";

describe("ContextOptimizerPanel", () => {
  beforeEach(() => {
    webview.html = "";
    panel.title = "";
    panel.reveal.mockClear();
  });

  it("renders removable paragraphs, savings, and a review-only notice", () => {
    const optimizerPanel = new ContextOptimizerPanel();
    const report = {
      generatedAt: "2026-07-20T14:00:00.000Z",
      prompt: "Task prompt",
      blockCount: 4,
      suggestionCount: 1,
      method: "lightweight",
      taskSummary: "Task: rewrite the prompt.",
      suggestions: [
        {
          block: { kind: "context", label: "Context", text: "Unrelated background paragraph.", tokenCount: 18, lineStart: 3, lineEnd: 5 },
          removableTokens: 18,
          relevancePercent: 8,
          savingsPercent: 100,
          reason: "Very low overlap with the task and instruction blocks.",
          removeSuggestion: "Remove the context paragraph if it does not change the desired output.",
          keepHint: "Keep only if it contains task-critical details."
        }
      ]
    } satisfies ContextOptimizationReport;

    optimizerPanel.show(report);

    expect(panel.title).toContain("Context Optimizer");
    expect(webview.html).toContain("Review-only mode");
    expect(webview.html).toContain("Potential savings 18 tokens");
    expect(webview.html).toContain("Remove suggestion");
  });
});