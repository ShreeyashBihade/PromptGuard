import * as vscode from "vscode";
import { DuplicateDetectionReport } from "../services/duplicates/promptDuplicateDetectionService";

export class DuplicateDetectionPanel {
  private panel?: vscode.WebviewPanel;

  show(report: DuplicateDetectionReport): void {
    if (!this.panel) {
      this.panel = vscode.window.createWebviewPanel(
        "promptguardDuplicateDetection",
        "PromptGuard Duplicate Detection",
        vscode.ViewColumn.Beside,
        { enableScripts: false, retainContextWhenHidden: true }
      );
      this.panel.onDidDispose(() => {
        this.panel = undefined;
      });
    } else {
      this.panel.reveal(vscode.ViewColumn.Beside);
    }

    this.panel.title = `PromptGuard Duplicate Detection (${report.matchCount})`;
    this.panel.webview.html = this.html(report);
  }

  private html(report: DuplicateDetectionReport): string {
    const rows = report.matches.length
      ? report.matches.map(match => `
        <section class="match">
          <header>
            <h2>${this.escape(match.left.label)} + ${this.escape(match.right.label)}</h2>
            <div class="meta">Similarity ${match.similarityPercent}% · Potential savings ${match.potentialSavingsTokens} tokens · ${this.escape(match.method)}</div>
          </header>
          <p class="reason">${this.escape(match.reason)}</p>
          <div class="blocks">
            <article>
              <h3>${this.escape(match.left.label)}</h3>
              <p>${this.escape(match.left.text)}</p>
            </article>
            <article>
              <h3>${this.escape(match.right.label)}</h3>
              <p>${this.escape(match.right.text)}</p>
            </article>
          </div>
          <div class="suggestion"><strong>Merge suggestion:</strong> ${this.escape(match.mergeSuggestion)}</div>
        </section>
      `).join("")
      : `<div class="empty">No duplicated ideas were detected with the lightweight similarity pass.</div>`;

    return `<!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <style>
          body { font-family: var(--vscode-font-family); color: var(--vscode-editor-foreground); background: var(--vscode-editor-background); padding: 20px; }
          .summary { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin-bottom: 18px; }
          .card, .match, .empty { border: 1px solid var(--vscode-editorWidget-border); border-radius: 10px; background: var(--vscode-editorWidget-background); }
          .card { padding: 14px; }
          .card .value { font-size: 1.4rem; font-weight: 700; }
          .match { padding: 16px; margin-bottom: 14px; }
          h1, h2, h3 { margin: 0 0 8px; }
          .meta { color: var(--vscode-descriptionForeground); font-size: 0.9rem; }
          .reason, .suggestion { margin-top: 10px; line-height: 1.5; }
          .blocks { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin-top: 12px; }
          article { padding: 10px; border-radius: 8px; background: color-mix(in srgb, var(--vscode-editor-background) 88%, transparent); border: 1px solid color-mix(in srgb, var(--vscode-editorWidget-border) 80%, transparent); }
          article p { white-space: pre-wrap; margin: 0; }
          .empty { padding: 16px; }
          @media (max-width: 900px) { .summary, .blocks { grid-template-columns: 1fr; } }
        </style>
      </head>
      <body>
        <h1>Duplicate Detection</h1>
        <div class="summary">
          <div class="card"><div class="label">Blocks</div><div class="value">${report.blockCount}</div></div>
          <div class="card"><div class="label">Matches</div><div class="value">${report.matchCount}</div></div>
          <div class="card"><div class="label">Method</div><div class="value">${this.escape(report.method)}</div></div>
        </div>
        ${rows}
      </body>
      </html>`;
  }

  private escape(value: string): string {
    return value.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character] ?? character));
  }
}