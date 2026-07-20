import * as vscode from "vscode";
import { DeadCodeEliminationReport, DeadCodeFinding } from "../services/deadCode/promptDeadCodeEliminationService";

const escapeHtml = (value: string): string => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;").replace(/'/g, "&#39;");

export class DeadCodeEliminationPanel {
  private panel?: vscode.WebviewPanel;

  show(report: DeadCodeEliminationReport): void {
    if (!this.panel) {
      this.panel = vscode.window.createWebviewPanel("promptguard.pdce", "PromptGuard Dead Code Elimination", vscode.ViewColumn.Beside, { enableScripts: false, retainContextWhenHidden: true });
      this.panel.onDidDispose(() => { this.panel = undefined; });
    } else {
      this.panel.reveal(vscode.ViewColumn.Beside);
    }

    this.panel.title = `PromptGuard Dead Code Elimination (${report.findingCount})`;
    this.panel.webview.html = this.html(report);
  }

  private html(report: DeadCodeEliminationReport): string {
    const findings = report.findings.length
      ? report.findings.map(finding => this.findingCard(finding)).join("")
      : `<div class="empty">No likely dead-code instructions were detected in this prompt.</div>`;

    return `<!doctype html>
      <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <style>
          body { font-family: var(--vscode-font-family); color: var(--vscode-editor-foreground); background: var(--vscode-editor-background); padding: 20px; }
          .note { margin: 0 0 16px; color: var(--vscode-descriptionForeground); }
          .summary { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 12px; margin-bottom: 18px; }
          .card, .finding, .empty { border: 1px solid var(--vscode-editorWidget-border); border-radius: 10px; background: var(--vscode-editorWidget-background); }
          .card { padding: 14px; }
          .card .value { font-size: 1.5rem; font-weight: 700; }
          .finding { padding: 16px; margin-bottom: 14px; }
          .head { display: flex; justify-content: space-between; gap: 12px; align-items: start; }
          h1, h2 { margin: 0 0 8px; }
          .meta { color: var(--vscode-descriptionForeground); font-size: 0.9rem; }
          .badge { display: inline-flex; align-items: center; gap: 6px; padding: 4px 8px; border-radius: 999px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; }
          .critical { background: color-mix(in srgb, #dc2626 18%, transparent); color: #f08a8a; }
          .medium { background: color-mix(in srgb, #c9a227 18%, transparent); color: #f2d45c; }
          .low { background: color-mix(in srgb, #26a269 18%, transparent); color: #71d39a; }
          .section { margin-top: 12px; padding: 10px; border-radius: 8px; border: 1px solid color-mix(in srgb, var(--vscode-editorWidget-border) 80%, transparent); background: color-mix(in srgb, var(--vscode-editor-background) 88%, transparent); }
          .section p { white-space: pre-wrap; margin: 0; line-height: 1.5; }
          .empty { padding: 16px; }
          .never { margin-top: 10px; color: var(--vscode-descriptionForeground); font-style: italic; }
          @media (max-width: 980px) { .summary { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
          @media (max-width: 640px) { .summary { grid-template-columns: 1fr; } }
        </style>
      </head>
      <body>
        <h1>Prompt Dead Code Elimination</h1>
        <p class="note">Experimental analysis only. PromptGuard never removes text automatically and only presents recommendations.</p>
        <div class="summary">
          <div class="card"><div class="label">Findings</div><div class="value">${report.findingCount}</div></div>
          <div class="card"><div class="label">Critical</div><div class="value">${report.criticalCount}</div></div>
          <div class="card"><div class="label">Medium</div><div class="value">${report.mediumCount}</div></div>
          <div class="card"><div class="label">Low</div><div class="value">${report.lowCount}</div></div>
          <div class="card"><div class="label">Potential savings</div><div class="value">${report.estimatedTotalSavingsTokens} tok</div></div>
        </div>
        ${findings}
      </body>
      </html>`;
  }

  private findingCard(finding: DeadCodeFinding): string {
    return `
      <section class="finding">
        <div class="head">
          <div>
            <h2>${escapeHtml(finding.title)}</h2>
            <div class="meta">Lines ${finding.evidence.lineStart}-${finding.evidence.lineEnd} · ${finding.estimatedTokenSavings} token savings · ${Math.round(finding.confidence * 100)}% confidence</div>
          </div>
          <span class="badge ${finding.impact}">${finding.impact}</span>
        </div>
        <div class="section"><strong>Why it matters</strong><p>${escapeHtml(finding.reason)}</p></div>
        <div class="section"><strong>Recommendation</strong><p>${escapeHtml(finding.recommendation)}</p></div>
        <div class="section"><strong>Evidence</strong><p>${escapeHtml(finding.evidence.text)}</p></div>
        <div class="never">Never remove automatically.</div>
      </section>`;
  }
}