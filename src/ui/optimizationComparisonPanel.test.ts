import { beforeEach, describe, expect, it, vi } from "vitest";
import { OptimizationSuggestion } from "../types";

const webview = { html: "" } as { html: string };
const panel = {
  webview,
  title: "",
  reveal: vi.fn(),
  onDidDispose: vi.fn()
};

vi.mock("vscode", () => ({
  ViewColumn: { Beside: 2 },
  env: { clipboard: { writeText: vi.fn() } },
  window: {
    createWebviewPanel: vi.fn(() => panel),
    showInformationMessage: vi.fn()
  }
}));

import { OptimizationComparisonPanel } from "./optimizationComparisonPanel";

describe("OptimizationComparisonPanel", () => {
  beforeEach(() => {
    webview.html = "";
    panel.title = "";
    panel.reveal.mockClear();
  });

  it("renders a Git-style diff view with per-change acceptance controls", () => {
    const comparison = new OptimizationComparisonPanel();
    const suggestion = {
      title: "Tighten wording",
      reason: "Deterministic compression",
      preview: "Task: summarize the report.",
      optimizedPrompt: "Task: summarize the report.",
      issuesAddressed: [],
      estimatedTokenSavings: 6,
      confidence: 0.8,
      diff: "- Please create a concise summary.\n+ Task: summarize the report.",
      diffView: {
        totalTokenSavings: 6,
        totalCostSavingsUsd: 0.000001,
        acceptedOptimizedPrompt: "Task: summarize the report.",
        changes: [
          {
            id: "change-1",
            type: "removed",
            lineNumber: 1,
            originalText: "Please create a concise summary.",
            tokenSavings: 6,
            costSavingsUsd: 0.000001,
            accepted: true
          },
          {
            id: "change-2",
            type: "added",
            lineNumber: 2,
            optimizedText: "Task: summarize the report.",
            tokenSavings: -4,
            costSavingsUsd: -0.0000003,
            accepted: true
          }
        ]
      },
      compressionSteps: []
    } satisfies OptimizationSuggestion;

    comparison.show("Please create a concise summary.", suggestion);

    expect(panel.title).toContain("Optimization Diff View");
    expect(webview.html).toContain("Accept all");
    expect(webview.html).toContain("Reject all");
    expect(webview.html).toContain("Added");
    expect(webview.html).toContain("Removed");
    expect(webview.html).toContain("Cost savings");
    expect(webview.html).toContain("Accept");
    expect(webview.html).toContain("Reject");
  });
});