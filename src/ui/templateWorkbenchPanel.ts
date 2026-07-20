import * as vscode from "vscode";
import { TemplateWorkbenchReport } from "../services/templates/promptTemplateWorkbenchService";

const escapeHtml = (value: string): string => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;").replace(/'/g, "&#39;");

export class TemplateWorkbenchPanel {
  private panel?: vscode.WebviewPanel;

  show(report: TemplateWorkbenchReport): void {
    if (!this.panel) {
      this.panel = vscode.window.createWebviewPanel("promptguard.templateWorkbench", "PromptGuard Prompt Templates", vscode.ViewColumn.Beside, { enableScripts: false, retainContextWhenHidden: true });
      this.panel.onDidDispose(() => { this.panel = undefined; });
    } else {
      this.panel.reveal(vscode.ViewColumn.Beside);
    }

    this.panel.title = `PromptGuard Prompt Templates (${report.suggestionCount})`;
    this.panel.webview.html = this.html(report);
  }

  private html(report: TemplateWorkbenchReport): string {
    const catalogSummary = report.catalogSummary.length
      ? report.catalogSummary.map(catalog => `
        <div class="card">
          <div class="label">${escapeHtml(catalog.scope)} templates</div>
          <div class="value">${catalog.templateCount}</div>
          <div class="muted">${escapeHtml(catalog.name ?? catalog.sourcePath)}</div>
        </div>
      `).join("")
      : `<div class="empty">No workspace, team, or global templates were found.</div>`;

    const templates = report.catalogTemplates.length
      ? report.catalogTemplates.map(template => `
        <section class="template">
          <header>
            <h2>${escapeHtml(template.name)}</h2>
            <div class="meta">${escapeHtml(template.scope)} · ${escapeHtml(template.sourcePath)}</div>
          </header>
          <p class="description">${escapeHtml(template.description)}</p>
          <div class="block"><strong>Variables</strong><p>${template.variables.length ? template.variables.map(variable => `{{${escapeHtml(variable.name)}}}`).join(", ") : "None detected"}</p></div>
          <div class="block"><strong>Snippet preview</strong><pre>${escapeHtml(template.content)}</pre></div>
        </section>
      `).join("")
      : `<div class="empty">Add promptguard.templates.json, .promptguard/templates.team.json, or a global promptguard.templates.json to populate the template catalog.</div>`;

    const suggestions = report.prefixSuggestions.length
      ? report.prefixSuggestions.map(suggestion => `
        <section class="suggestion">
          <header>
            <h2>${escapeHtml(suggestion.prefix)}</h2>
            <div class="meta">Occurrences ${suggestion.occurrences} · Savings ${suggestion.estimatedSavingsTokens} tokens</div>
          </header>
          <p class="description">${escapeHtml(suggestion.reason)}</p>
          <div class="block"><strong>Reusable template</strong><pre>${escapeHtml(suggestion.templatePreview + "{{details}}")} </pre></div>
          <div class="block"><strong>Snippet expansion</strong><pre>${escapeHtml(suggestion.snippetBody)}</pre></div>
          <div class="block"><strong>Examples</strong><p>${suggestion.examples.map(example => escapeHtml(example)).join("<br/>")}</p></div>
        </section>
      `).join("")
      : `<div class="empty">No repeated prompt prefixes were detected in the current prompt or recent history.</div>`;

    return `<!doctype html>
      <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <style>
          body { font-family: var(--vscode-font-family); color: var(--vscode-editor-foreground); background: var(--vscode-editor-background); padding: 20px; }
          .summary { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin-bottom: 18px; }
          .card, .template, .suggestion, .empty { border: 1px solid var(--vscode-editorWidget-border); border-radius: 10px; background: var(--vscode-editorWidget-background); }
          .card { padding: 14px; }
          .card .value { font-size: 1.5rem; font-weight: 700; }
          .template, .suggestion { padding: 16px; margin-bottom: 14px; }
          h1, h2 { margin: 0 0 8px; }
          .meta { color: var(--vscode-descriptionForeground); font-size: 0.9rem; }
          .description, .muted { margin: 10px 0 0; line-height: 1.5; }
          .block { margin-top: 12px; padding: 10px; border-radius: 8px; border: 1px solid color-mix(in srgb, var(--vscode-editorWidget-border) 80%, transparent); background: color-mix(in srgb, var(--vscode-editor-background) 88%, transparent); }
          .block p, .block pre { white-space: pre-wrap; margin: 0; }
          pre { overflow-x: auto; }
          .empty { padding: 16px; }
          .section-title { margin: 18px 0 12px; font-size: 1.05rem; }
          @media (max-width: 900px) { .summary { grid-template-columns: 1fr; } }
        </style>
      </head>
      <body>
        <h1>Prompt Templates</h1>
        <p class="muted">Review-only mode: PromptGuard suggests reusable templates, variables, and snippet expansions without changing files automatically.</p>
        <div class="summary">
          <div class="card"><div class="label">Templates</div><div class="value">${report.templateCount}</div></div>
          <div class="card"><div class="label">Repeated prefixes</div><div class="value">${report.suggestionCount}</div></div>
          <div class="card"><div class="label">Method</div><div class="value">${escapeHtml(report.method)}</div></div>
        </div>
        <div class="section-title">Catalog by scope</div>
        ${catalogSummary}
        <div class="section-title">Template catalog</div>
        ${templates}
        <div class="section-title">Reusable prefix suggestions</div>
        ${suggestions}
      </body>
      </html>`;
  }
}