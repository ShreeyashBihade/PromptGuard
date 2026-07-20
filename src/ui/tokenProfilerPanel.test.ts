import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TokenProfileReport } from "../services/tokenProfiler";

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

import { TokenProfilerPanel } from "./tokenProfilerPanel";

describe("TokenProfilerPanel", () => {
  beforeEach(() => {
    webview.html = "";
    panel.title = "";
    panel.reveal.mockClear();
  });

  it("renders a token heatmap with severity legend and hover reasons", () => {
    const heatmap = new TokenProfilerPanel();
    const report = {
      updatedAt: "2026-07-20T14:00:00.000Z",
      totalTokens: 240,
      sections: [
        {
          kind: "context",
          label: "Context",
          text: "A large context block",
          tokenCount: 120,
          importance: 20,
          ambiguityScore: 10,
          duplicateScore: 5,
          lineStart: 1,
          lineEnd: 8,
          estimatedInputCostUsd: 0.00012,
          estimatedOutputCostUsd: 0.00024,
          potentialSavingsTokens: 18,
          cached: false,
          children: []
        },
        {
          kind: "task",
          label: "Task",
          text: "Core task",
          tokenCount: 40,
          importance: 80,
          ambiguityScore: 0,
          duplicateScore: 0,
          lineStart: 9,
          lineEnd: 12,
          estimatedInputCostUsd: 0.00004,
          estimatedOutputCostUsd: 0.00008,
          potentialSavingsTokens: 2,
          cached: false,
          children: []
        }
      ],
      estimatedInputCostUsd: 0.00016,
      estimatedOutputCostUsd: 0.00032,
      latencyMs: 260,
      mostExpensiveSection: undefined,
      potentialSavingsTokens: 20,
      potentialSavingsUsd: 0.00002,
      cacheHits: 0,
      cacheMisses: 2
    } satisfies TokenProfileReport;

    heatmap.show(report);

    expect(webview.html).toContain("Green: low cost");
    expect(webview.html).toContain("Yellow: moderate");
    expect(webview.html).toContain("Orange: high");
    expect(webview.html).toContain("Red: very high");
    expect(webview.html).toContain("severity-");
    expect(webview.html).toContain("low importance");
    expect(webview.html).toContain("duplicate risk");
  });
});