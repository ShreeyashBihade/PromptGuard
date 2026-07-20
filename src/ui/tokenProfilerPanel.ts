import * as vscode from "vscode";
import { TokenProfileReport, TokenProfileSection } from "../services/tokenProfiler";

const escapeHtml = (value: string): string => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

export class TokenProfilerPanel {
  private panel?: vscode.WebviewPanel;

  show(report: TokenProfileReport): void {
    if (!this.panel) {
      this.panel = vscode.window.createWebviewPanel("promptguard.tokenProfiler", "PromptGuard Token Profiler", vscode.ViewColumn.Beside, { enableScripts: true, retainContextWhenHidden: true });
      this.panel.onDidDispose(() => { this.panel = undefined; });
    }
    this.panel.title = "PromptGuard Token Profiler";
    this.panel.webview.html = this.html(report);
    this.panel.reveal(vscode.ViewColumn.Beside);
  }

  update(report: TokenProfileReport): void {
    if (!this.panel) return;
    this.panel.webview.html = this.html(report);
  }

  hasPanel(): boolean { return Boolean(this.panel); }

  private html(report: TokenProfileReport): string {
    const severityScale = this.severityScale(report);
    const sections = report.sections.map(section => this.sectionRow(section, severityScale)).join("");
    const mostExpensive = report.mostExpensiveSection ? `${escapeHtml(report.mostExpensiveSection.label)} (${report.mostExpensiveSection.tokenCount} tokens)` : "None";
    return `<!doctype html>
      <html>
        <head>
          <meta charset="UTF-8">
          <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
          <style>
            body{margin:0;padding:20px;font-family:var(--vscode-font-family);color:var(--vscode-foreground);background:var(--vscode-editor-background)}
            .grid{display:grid;grid-template-columns:repeat(4,minmax(140px,1fr));gap:10px;margin-bottom:14px}
            .stat{padding:12px;border-radius:10px;border:1px solid var(--vscode-widget-border);background:var(--vscode-editorWidget-background)}
            .label{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--vscode-descriptionForeground)}
            .value{margin-top:4px;font-size:20px;font-weight:700}
            .legend{display:flex;flex-wrap:wrap;gap:8px;margin:10px 0 16px}
            .legend-item{display:inline-flex;align-items:center;gap:8px;padding:6px 10px;border-radius:999px;border:1px solid var(--vscode-widget-border);background:var(--vscode-editorWidget-background);font-size:12px}
            .swatch{width:12px;height:12px;border-radius:4px;display:inline-block}
            table{width:100%;border-collapse:collapse}
            th,td{padding:9px 8px;border-bottom:1px solid var(--vscode-widget-border);text-align:left;vertical-align:top}
            th{font-size:11px;color:var(--vscode-descriptionForeground);text-transform:uppercase;letter-spacing:.06em}
            .muted{color:var(--vscode-descriptionForeground)}
            .pill{display:inline-block;padding:3px 8px;border-radius:999px;background:color-mix(in srgb,var(--vscode-button-background) 18%, transparent);margin-right:6px;font-size:11px}
            .section-title{font-weight:700}
            .child{padding-left:16px;color:var(--vscode-descriptionForeground)}
            .heat-row{transition:transform .15s ease, box-shadow .15s ease, background-color .15s ease}
            .heat-row:hover{transform:translateY(-1px);box-shadow:0 6px 18px rgba(0,0,0,.16)}
            .severity-green{background:linear-gradient(90deg, color-mix(in srgb,#26a269 28%, transparent), transparent 78%)}
            .severity-yellow{background:linear-gradient(90deg, color-mix(in srgb,#c9a227 28%, transparent), transparent 78%)}
            .severity-orange{background:linear-gradient(90deg, color-mix(in srgb,#d97706 30%, transparent), transparent 78%)}
            .severity-red{background:linear-gradient(90deg, color-mix(in srgb,#dc2626 32%, transparent), transparent 78%)}
            .severity-chip{display:inline-flex;align-items:center;gap:6px;margin-top:6px;padding:4px 8px;border-radius:999px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em}
            .severity-chip .swatch{width:8px;height:8px;border-radius:999px}
            .severity-chip.green{background:color-mix(in srgb,#26a269 16%, transparent);color:#71d39a}
            .severity-chip.yellow{background:color-mix(in srgb,#c9a227 16%, transparent);color:#f2d45c}
            .severity-chip.orange{background:color-mix(in srgb,#d97706 16%, transparent);color:#f5ad5f}
            .severity-chip.red{background:color-mix(in srgb,#dc2626 18%, transparent);color:#f08a8a}
            .child.expensive{font-weight:600}
            .child.expensive .muted{color:var(--vscode-foreground)}
            @media (max-width: 980px){.grid{grid-template-columns:repeat(2,minmax(140px,1fr))}}
            @media (max-width: 640px){.grid{grid-template-columns:1fr}}
          </style>
        </head>
        <body>
          <h1>Live Token Intelligence</h1>
          <p class="muted">Updated ${escapeHtml(new Date(report.updatedAt).toLocaleTimeString())}. Cache hits: ${report.cacheHits} · cache misses: ${report.cacheMisses}</p>
          <div class="legend">
            <div class="legend-item"><span class="swatch" style="background:#26a269"></span>Green: low cost</div>
            <div class="legend-item"><span class="swatch" style="background:#c9a227"></span>Yellow: moderate</div>
            <div class="legend-item"><span class="swatch" style="background:#d97706"></span>Orange: high</div>
            <div class="legend-item"><span class="swatch" style="background:#dc2626"></span>Red: very high</div>
          </div>
          <div class="grid">
            <div class="stat"><div class="label">Total tokens</div><div class="value">${report.totalTokens}</div></div>
            <div class="stat"><div class="label">Input cost</div><div class="value">${this.money(report.estimatedInputCostUsd)}</div></div>
            <div class="stat"><div class="label">Output cost</div><div class="value">${this.money(report.estimatedOutputCostUsd)}</div></div>
            <div class="stat"><div class="label">Latency estimate</div><div class="value">${report.latencyMs}ms</div></div>
          </div>
          <div class="grid" style="margin-bottom:16px">
            <div class="stat"><div class="label">Most expensive section</div><div class="value" style="font-size:16px">${mostExpensive}</div></div>
            <div class="stat"><div class="label">Potential savings</div><div class="value">${report.potentialSavingsTokens} tok</div></div>
            <div class="stat"><div class="label">Projected savings</div><div class="value">${this.money(report.potentialSavingsUsd)}</div></div>
            <div class="stat"><div class="label">Sections</div><div class="value">${report.sections.length}</div></div>
          </div>
          <table>
            <thead>
              <tr><th>Section</th><th>Tokens</th><th>Why expensive</th><th>Estimated savings</th></tr>
            </thead>
            <tbody>${sections}</tbody>
          </table>
        </body>
      </html>`;
  }

  private sectionRow(section: TokenProfileSection, severityScale: { low: number; moderate: number; high: number }): string {
    const severity = this.severityFor(section, severityScale);
    const reason = [
      section.importance < 50 ? "low importance" : undefined,
      section.ambiguityScore > 40 ? `ambiguous (${section.ambiguityScore}%)` : undefined,
      section.duplicateScore > 0 ? `duplicate risk (${section.duplicateScore}%)` : undefined
    ].filter(Boolean).join(" · ") || "high value / context-heavy";

    const title = `${section.label} · ${reason} · ${section.tokenCount} tokens · ${section.potentialSavingsTokens} tokens potentially saved`;
    const children = section.children.map(child => this.childRow(child, severityScale)).join("");
    return `<tr class="heat-row severity-${severity}" title="${escapeHtml(title)}"><td><div class="section-title">${escapeHtml(section.label)}</div><div class="muted">Lines ${section.lineStart}-${section.lineEnd}${section.cached ? ' · cached' : ''}</div><div class="severity-chip ${severity}"><span class="swatch"></span>${severity}</div></td><td>${section.tokenCount}</td><td>${escapeHtml(reason)}</td><td>${section.potentialSavingsTokens} tok</td></tr>${children}`;
  }

  private childRow(section: TokenProfileSection, severityScale: { low: number; moderate: number; high: number }): string {
    const severity = this.severityFor(section, severityScale);
    const reason = this.reasonFor(section);
    const title = `${section.label} · ${reason} · ${section.tokenCount} tokens · ${section.potentialSavingsTokens} tokens potentially saved`;
    return `<tr class="heat-row severity-${severity}"><td class="child ${severity === "orange" || severity === "red" ? "expensive" : ""}" title="${escapeHtml(title)}">↳ ${escapeHtml(section.label)}</td><td>${section.tokenCount}</td><td class="muted">${escapeHtml(reason)}</td><td>${section.potentialSavingsTokens} tok</td></tr>`;
  }

  private reasonFor(section: TokenProfileSection): string {
    return [
      section.importance < 50 ? "low importance" : undefined,
      section.ambiguityScore > 40 ? `ambiguous (${section.ambiguityScore}%)` : undefined,
      section.duplicateScore > 0 ? `duplicate risk (${section.duplicateScore}%)` : undefined
    ].filter(Boolean).join(" · ") || "high value / context-heavy";
  }

  private severityScale(report: TokenProfileReport): { low: number; moderate: number; high: number } {
    const maxCost = Math.max(...report.sections.map(section => this.sectionCost(section)), 1);
    return {
      low: maxCost * 0.25,
      moderate: maxCost * 0.5,
      high: maxCost * 0.8
    };
  }

  private severityFor(section: TokenProfileSection, scale: { low: number; moderate: number; high: number }): "green" | "yellow" | "orange" | "red" {
    const cost = this.sectionCost(section);
    if (cost <= scale.low) return "green";
    if (cost <= scale.moderate) return "yellow";
    if (cost <= scale.high) return "orange";
    return "red";
  }

  private sectionCost(section: TokenProfileSection): number {
    return section.estimatedInputCostUsd + section.estimatedOutputCostUsd;
  }

  private money(value: number): string { return `$${value.toFixed(6)}`; }
}
