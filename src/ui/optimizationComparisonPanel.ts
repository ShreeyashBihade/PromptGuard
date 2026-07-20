import * as vscode from "vscode";
import { OptimizationDiffChange, OptimizationSuggestion } from "../types";

const escapeHtml = (value: string): string => value
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/\"/g, "&quot;")
  .replace(/'/g, "&#39;");

export class OptimizationComparisonPanel {
  private panel?: vscode.WebviewPanel;
  private originalPrompt = "";
  private suggestion?: OptimizationSuggestion;
  constructor(private readonly onDecision?: (accepted: boolean) => void) {}

  show(originalPrompt: string, suggestion: OptimizationSuggestion): void {
    this.originalPrompt = originalPrompt;
    this.suggestion = suggestion;
    if (!this.panel) {
      this.panel = vscode.window.createWebviewPanel(
        "promptguard.optimize.compare",
        "PromptGuard Optimization Diff View",
        vscode.ViewColumn.Beside,
        { enableScripts: true, retainContextWhenHidden: true }
      );
      this.panel.onDidDispose(() => { this.panel = undefined; });
      if (typeof this.panel.webview.onDidReceiveMessage === "function") {
        this.panel.webview.onDidReceiveMessage(async (message: unknown) => {
          const payload = typeof message === "object" && message !== null ? message as { type?: unknown; changeId?: unknown; accepted?: unknown } : undefined;
          const type = payload?.type;
          if (type === "toggle-change" && typeof payload?.changeId === "string" && typeof payload?.accepted === "boolean") {
            this.toggleChange(payload.changeId, payload.accepted);
            return;
          }
          if (type === "accept-all") {
            this.setAllChanges(true);
            this.onDecision?.(true);
            return;
          }
          if (type === "reject-all") {
            this.setAllChanges(false);
            this.onDecision?.(false);
            return;
          }
          if (type === "copy-accepted" && this.suggestion) {
            await vscode.env.clipboard.writeText(this.currentAcceptedPrompt());
            void vscode.window.showInformationMessage("PromptGuard: accepted preview copied to clipboard.");
          }
        });
      }
    }

    this.panel.title = "PromptGuard Optimization Diff View";
    this.panel.webview.html = this.html();
    this.panel.reveal(vscode.ViewColumn.Beside);
  }

  private html(): string {
    const suggestion = this.suggestion;
    const diffView = suggestion?.diffView;
    const savings = diffView?.totalTokenSavings ?? suggestion?.estimatedTokenSavings ?? 0;
    const costSavings = diffView?.totalCostSavingsUsd ?? 0;
    const confidence = suggestion?.confidence ?? 0;
    const changes = diffView?.changes ?? [];
    const safeOriginal = escapeHtml(this.originalPrompt);
    const safeAccepted = escapeHtml(this.currentAcceptedPrompt());
    const diffRows = changes.length ? changes.map((change: OptimizationDiffChange) => this.changeRow(change)).join("") : `<div class="empty">No diff changes available.</div>`;
    return `<!doctype html>
      <html>
        <head>
          <meta charset="UTF-8">
          <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
          <style>
            body { margin: 0; padding: 20px; font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); }
            .head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; margin-bottom: 12px; }
            h1 { margin: 0; font-size: 18px; }
            .hint { margin: 0; color: var(--vscode-descriptionForeground); font-size: 12px; }
            .toolbar { display: flex; flex-wrap: wrap; gap: 8px; justify-content: flex-end; }
            .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
            .card { border: 1px solid var(--vscode-widget-border); border-radius: 10px; padding: 12px; background: var(--vscode-editorWidget-background); }
            .label { margin: 0 0 8px; font-size: 12px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--vscode-descriptionForeground); }
            pre { margin: 0; white-space: pre-wrap; word-break: break-word; min-height: 280px; max-height: 58vh; overflow: auto; background: var(--vscode-textCodeBlock-background); border-radius: 8px; padding: 10px; }
            button { border: 0; border-radius: 8px; padding: 8px 12px; font: inherit; cursor: pointer; color: var(--vscode-button-foreground); background: var(--vscode-button-background); }
            button:hover { filter: brightness(1.06); }
            button.secondary { color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); }
            .meta { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin: 12px 0; }
            .metric { border: 1px solid var(--vscode-widget-border); border-radius: 10px; padding: 10px 12px; background: var(--vscode-editorWidget-background); }
            .metric .k { font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--vscode-descriptionForeground); }
            .metric .v { margin-top: 4px; font-size: 18px; font-weight: 700; }
            .changes { margin-top: 12px; display: grid; gap: 10px; }
            .change { border: 1px solid var(--vscode-widget-border); border-radius: 10px; padding: 12px; background: var(--vscode-editorWidget-background); }
            .change-head { display: flex; justify-content: space-between; gap: 12px; align-items: center; }
            .badge { display: inline-flex; align-items: center; gap: 6px; padding: 4px 8px; border-radius: 999px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; }
            .added { background: color-mix(in srgb, #26a269 18%, transparent); color: #71d39a; }
            .removed { background: color-mix(in srgb, #dc2626 18%, transparent); color: #f08a8a; }
            .modified { background: color-mix(in srgb, #c9a227 18%, transparent); color: #f2d45c; }
            .change-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 10px; }
            .change-grid.single { grid-template-columns: 1fr; }
            .change-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
            .accepted { border-left: 4px solid #26a269; }
            .rejected { border-left: 4px solid #dc2626; opacity: 0.84; }
            .summary-line { margin-top: 8px; color: var(--vscode-descriptionForeground); font-size: 12px; }
            .empty { padding: 16px; border: 1px solid var(--vscode-widget-border); border-radius: 10px; }
            @media (max-width: 980px) { .grid { grid-template-columns: 1fr; } }
            @media (max-width: 720px) { .meta { grid-template-columns: 1fr; } }
          </style>
        </head>
        <body>
          <div class="head">
            <div>
              <h1>Prompt diff view</h1>
              <p class="hint">Review the Git-style diff, accept or reject changes individually, and copy the accepted preview when you're done.</p>
            </div>
            <div class="toolbar">
              <button id="accept-all">Accept all</button>
              <button id="reject-all" class="secondary">Reject all</button>
              <button id="copy">Copy accepted preview</button>
            </div>
          </div>
          <div class="meta">
            <div class="metric"><div class="k">Estimated savings</div><div class="v">${savings} tokens</div></div>
            <div class="metric"><div class="k">Cost savings</div><div class="v">${this.money(costSavings)}</div></div>
            <div class="metric"><div class="k">Confidence</div><div class="v">${Math.round(confidence * 100)}%</div></div>
          </div>
          <div class="summary-line">${escapeHtml(suggestion?.reason ?? "No suggestion available.")}</div>
          <div class="grid">
            <section class="card">
              <p class="label">Original prompt</p>
              <pre>${safeOriginal}</pre>
            </section>
            <section class="card">
                <p class="label">Accepted preview</p>
              <pre id="accepted-preview">${safeAccepted}</pre>
            </section>
          </div>
          <p class="hint">Note: no prompt is modified automatically.</p>
          <section class="changes">
            ${diffRows}
          </section>
          <script>
            const vscode = acquireVsCodeApi();
            document.getElementById('copy').addEventListener('click', () => vscode.postMessage({ type: 'copy-accepted' }));
            document.getElementById('accept-all').addEventListener('click', () => vscode.postMessage({ type: 'accept-all' }));
            document.getElementById('reject-all').addEventListener('click', () => vscode.postMessage({ type: 'reject-all' }));
            document.querySelectorAll('[data-change-id]').forEach(button => {
              button.addEventListener('click', event => {
                const target = event.currentTarget;
                const changeId = target.getAttribute('data-change-id');
                const accepted = target.getAttribute('data-accepted') === 'true';
                vscode.postMessage({ type: 'toggle-change', changeId, accepted });
              });
            });
          </script>
        </body>
      </html>`;
  }

  private changeRow(change: OptimizationDiffChange): string {
    const isModified = change.type === "modified";
    const original = change.originalText ? escapeHtml(change.originalText) : "";
    const optimized = change.optimizedText ? escapeHtml(change.optimizedText) : "";
    return `
      <article class="change ${change.accepted ? "accepted" : "rejected"}">
        <div class="change-head">
          <div>
            <span class="badge ${change.type}">${change.type}</span>
            <strong>Line ${change.lineNumber}</strong>
          </div>
          <div class="hint">${change.tokenSavings >= 0 ? "+" : ""}${change.tokenSavings} tokens · ${this.money(change.costSavingsUsd)}</div>
        </div>
        <div class="change-grid ${isModified ? "" : "single"}">
          ${change.originalText !== undefined ? `<div class="card"><p class="label">Removed</p><pre>${original}</pre></div>` : ""}
          ${change.optimizedText !== undefined ? `<div class="card"><p class="label">Added</p><pre>${optimized}</pre></div>` : ""}
        </div>
        <div class="change-actions">
          <button data-change-id="${escapeHtml(change.id)}" data-accepted="true">Accept</button>
          <button data-change-id="${escapeHtml(change.id)}" data-accepted="false" class="secondary">Reject</button>
        </div>
      </article>`;
  }

  private toggleChange(changeId: string, accepted: boolean): void {
    if (!this.suggestion?.diffView) {
      return;
    }

    this.suggestion = {
      ...this.suggestion,
      diffView: {
        ...this.suggestion.diffView,
        changes: this.suggestion.diffView.changes.map(change => change.id === changeId ? { ...change, accepted } : change)
      }
    };
    this.render();
  }

  private setAllChanges(accepted: boolean): void {
    if (!this.suggestion?.diffView) {
      return;
    }

    this.suggestion = {
      ...this.suggestion,
      diffView: {
        ...this.suggestion.diffView,
        changes: this.suggestion.diffView.changes.map(change => ({ ...change, accepted }))
      }
    };
    this.render();
  }

  private currentAcceptedPrompt(): string {
    const suggestion = this.suggestion;
    const diffView = suggestion?.diffView;
    if (!suggestion || !diffView) {
      return "";
    }

    const originalLines = this.originalPrompt.split(/\r?\n/);
    const changesByLine = new Map<number, OptimizationDiffChange[]>();
    for (const change of diffView.changes) {
      const list = changesByLine.get(change.lineNumber) ?? [];
      list.push(change);
      changesByLine.set(change.lineNumber, list);
    }

    const result: string[] = [];
    for (let index = 1; index <= originalLines.length + 1; index += 1) {
      const changes = changesByLine.get(index) ?? [];
      for (const change of changes.filter(item => item.type === "added")) {
        if (change.accepted && change.optimizedText) {
          result.push(change.optimizedText);
        }
      }

      const originalLine = originalLines[index - 1];
      if (originalLine === undefined) {
        continue;
      }

      const modified = changes.find(item => item.type === "modified");
      const removed = changes.find(item => item.type === "removed");
      if (modified) {
        result.push(modified.accepted && modified.optimizedText ? modified.optimizedText : modified.originalText ?? originalLine);
        continue;
      }
      if (removed) {
        if (!removed.accepted) {
          result.push(removed.originalText ?? originalLine);
        }
        continue;
      }
      result.push(originalLine);
    }

    return result.join("\n");
  }

  private render(): void {
    if (this.panel && this.suggestion) {
      this.panel.webview.html = this.html();
    }
  }

  private money(value: number): string {
    return `$${Math.max(0, value).toFixed(6)}`;
  }
}
