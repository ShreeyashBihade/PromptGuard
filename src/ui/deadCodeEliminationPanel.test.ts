import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DeadCodeEliminationReport } from "../services/deadCode/promptDeadCodeEliminationService";

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

import { DeadCodeEliminationPanel } from "./deadCodeEliminationPanel";

describe("DeadCodeEliminationPanel", () => {
  beforeEach(() => {
    webview.html = "";
    panel.title = "";
    panel.reveal.mockClear();
  });

  it("renders impact levels, savings, and the never-remove note", () => {
    const deadCodePanel = new DeadCodeEliminationPanel();
    const report = {
      generatedAt: "2026-07-20T14:00:00.000Z",
      prompt: "Task prompt",
      method: "experimental",
      blockCount: 3,
      findingCount: 1,
      criticalCount: 1,
      mediumCount: 0,
      lowCount: 0,
      estimatedTotalSavingsTokens: 12,
      findings: [
        {
          id: "duplicate-instructions-1-2",
          category: "duplicate-instructions",
          title: "Duplicate instructions",
          impact: "critical",
          estimatedTokenSavings: 12,
          confidence: 0.91,
          evidence: { lineStart: 1, lineEnd: 2, text: "Repeat instruction" },
          reason: "The instructions duplicate each other.",
          recommendation: "Merge the repeated instruction into one line.",
          neverRemoveAutomatically: true
        }
      ]
    } satisfies DeadCodeEliminationReport;

    deadCodePanel.show(report);

    expect(panel.title).toContain("Dead Code Elimination");
    expect(webview.html).toContain("Experimental analysis only");
    expect(webview.html).toContain("Potential savings");
    expect(webview.html).toContain("Never remove automatically");
  });
});