import * as vscode from "vscode";
import { ContextOptimizationReport } from "../services/context/promptContextOptimizerService";

const escapeHtml = (value: string): string => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;").replace(/'/g, "&#39;");

export class ContextOptimizerPanel {
  private panel?: vscode.WebviewPanel;

  show(report: ContextOptimizationReport): void {
    if (!this.panel) {
      this.panel = vscode.window.createWebviewPanel("promptguard.contextOptimizer", "PromptGuard Context Optimizer", vscode.ViewColumn.Beside, { enableScripts: false, retainContextWhenHidden: true });
      this.panel.onDidDispose(() => { this.panel = undefined; });
    } else {
      this.panel.reveal(vscode.ViewColumn.Beside);
    }

    this.panel.title = `PromptGuard Context Optimizer (${report.suggestionCount})`;
    this.panel.webview.html = this.html(report);
  }

  private html(report: ContextOptimizationReport): string {
    const suggestions = report.suggestions.length
      ? report.suggestions.map(suggestion => `
        <section class="suggestion">
          <header>
            <h2>${escapeHtml(suggestion.block.label)}</h2>
            <div class="meta">Relevance ${suggestion.relevancePercent}% · Potential savings ${suggestion.removableTokens} tokens</div>
          </header>
          <p class="reason">${escapeHtml(suggestion.reason)}</p>
          <div class="block"><strong>Paragraph</strong><p>${escapeHtml(suggestion.block.text)}</p></div>
          <div class="actions">
            <div><strong>Remove suggestion:</strong> ${escapeHtml(suggestion.removeSuggestion)}</div>
            <div><strong>Keep hint:</strong> ${escapeHtml(suggestion.keepHint)}</div>
          </div>
        </section>
      `).join("")
      : `<div class="empty">No unnecessary context was detected with the lightweight pass.</div>`;

    return `<!doctype html>
      <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <style>
          body { font-family: var(--vscode-font-family); color: var(--vscode-editor-foreground); background: var(--vscode-editor-background); padding: 20px; }
          .summary { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin-bottom: 18px; }
          .card, .suggestion, .empty { border: 1px solid var(--vscode-editorWidget-border); border-radius: 10px; background: var(--vscode-editorWidget-background); }
          .card { padding: 14px; }
          .card .value { font-size: 1.4rem; font-weight: 700; }
          .suggestion { padding: 16px; margin-bottom: 14px; }
          h1, h2 { margin: 0 0 8px; }
          .meta { color: var(--vscode-descriptionForeground); font-size: 0.9rem; }
          .reason, .actions { margin-top: 10px; line-height: 1.5; }
          .block { margin-top: 12px; padding: 10px; border-radius: 8px; border: 1px solid color-mix(in srgb, var(--vscode-editorWidget-border) 80%, transparent); background: color-mix(in srgb, var(--vscode-editor-background) 88%, transparent); }
          .block p { white-space: pre-wrap; margin: 0; }
          .empty { padding: 16px; }
          .note { margin-top: 6px; color: var(--vscode-descriptionForeground); }
          @media (max-width: 980px) { .summary { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
          @media (max-width: 640px) { .summary { grid-template-columns: 1fr; } }
        </style>
      </head>
      <body>
        <h1>Context Optimizer</h1>
        <p class="note">Review-only mode: PromptGuard never removes text automatically.</p>
        <div class="summary">
          <div class="card"><div class="label">Blocks</div><div class="value">${report.blockCount}</div></div>
          <div class="card"><div class="label">Suggestions</div><div class="value">${report.suggestionCount}</div></div>
          <div class="card"><div class="label">Method</div><div class="value">${escapeHtml(report.method)}</div></div>
          <div class="card"><div class="label">Task summary</div><div class="value" style="font-size:16px">${escapeHtml(report.taskSummary)}</div></div>
        </div>
        ${suggestions}
      </body>
      </html>`;
  }
}