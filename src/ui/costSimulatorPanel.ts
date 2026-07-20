import * as vscode from "vscode";
import { CostSimulatorReport } from "../types";

const escapeHtml = (value: string): string => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;").replace(/'/g, "&#39;");

export class CostSimulatorPanel {
  private panel?: vscode.WebviewPanel;

  show(report: CostSimulatorReport): void {
    if (!this.panel) {
      this.panel = vscode.window.createWebviewPanel("promptguard.costSimulator", "PromptGuard Cost Simulator", vscode.ViewColumn.Beside, { enableScripts: false, retainContextWhenHidden: true });
      this.panel.onDidDispose(() => { this.panel = undefined; });
    } else {
      this.panel.reveal(vscode.ViewColumn.Beside);
    }

    this.panel.title = "PromptGuard Cost Simulator";
    this.panel.webview.html = this.html(report);
  }

  private html(report: CostSimulatorReport): string {
    const providerRows = report.providerComparisons.map(provider => `
      <tr>
        <td><strong>${escapeHtml(provider.displayName)}</strong><div class="muted">${escapeHtml(provider.provider)}</div></td>
        <td>${this.money(provider.inputCostUsdPerRun)}</td>
        <td>${this.money(provider.outputCostUsdPerRun)}</td>
        <td>${provider.latencyMs}ms</td>
        <td>${provider.monthlyRuns.toLocaleString()}</td>
        <td>${provider.yearlyRuns.toLocaleString()}</td>
        <td>${this.money(provider.savingsAfterOptimizationMonthlyUsd)}</td>
      </tr>
    `).join("");

    return `<!doctype html>
      <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <style>
          body { margin: 0; padding: 20px; font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); }
          .hero { display: grid; gap: 12px; grid-template-columns: 1.2fr 0.8fr; align-items: start; margin-bottom: 14px; }
          .card, .panel { border: 1px solid var(--vscode-widget-border); border-radius: 12px; padding: 14px; background: var(--vscode-editorWidget-background); }
          .grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; margin-bottom: 14px; }
          .stat .label, .label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--vscode-descriptionForeground); }
          .stat .value { margin-top: 4px; font-size: 18px; font-weight: 700; }
          table { width: 100%; border-collapse: collapse; margin-top: 10px; }
          th, td { padding: 10px 8px; border-bottom: 1px solid var(--vscode-widget-border); text-align: left; vertical-align: top; }
          th { font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--vscode-descriptionForeground); }
          .muted { color: var(--vscode-descriptionForeground); font-size: 12px; }
          .empty { padding: 16px; border: 1px solid var(--vscode-widget-border); border-radius: 10px; }
          .provider-table { overflow-x: auto; }
          @media (max-width: 980px) { .hero { grid-template-columns: 1fr; } .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
          @media (max-width: 640px) { .grid { grid-template-columns: 1fr; } }
        </style>
      </head>
      <body>
        <div class="hero">
          <div class="panel">
            <div class="label">Cost simulator</div>
            <h1>Multi-provider cost planning</h1>
            <p class="muted">Provider pricing comes from promptguard.providerPricing and projected usage comes from promptguard.costSimulatorMonthlyRuns.</p>
          </div>
          <div class="panel">
            <div class="label">Optimization savings</div>
            <div style="font-size: 30px; font-weight: 800; margin-top: 8px;">${this.money(report.optimizationSavingsUsd)}</div>
            <div class="muted">${report.optimizationSavingsTokens} tokens saved after optimization</div>
          </div>
        </div>
        <div class="grid">
          <div class="card stat"><div class="label">Input cost</div><div class="value">${this.money(report.providerComparisons[0]?.inputCostUsdPerRun ?? 0)}</div></div>
          <div class="card stat"><div class="label">Output cost</div><div class="value">${this.money(report.providerComparisons[0]?.outputCostUsdPerRun ?? 0)}</div></div>
          <div class="card stat"><div class="label">Latency</div><div class="value">${report.providerComparisons[0]?.latencyMs ?? 0}ms</div></div>
          <div class="card stat"><div class="label">Monthly usage</div><div class="value">${report.monthlyRuns.toLocaleString()} runs</div></div>
          <div class="card stat"><div class="label">Yearly usage</div><div class="value">${report.yearlyRuns.toLocaleString()} runs</div></div>
          <div class="card stat"><div class="label">Monthly tokens</div><div class="value">${(report.inputTokens * report.monthlyRuns).toLocaleString()} tok</div></div>
          <div class="card stat"><div class="label">Yearly tokens</div><div class="value">${(report.inputTokens * report.yearlyRuns).toLocaleString()} tok</div></div>
          <div class="card stat"><div class="label">Optimization latency</div><div class="value">${report.providerComparisons[0]?.latencyMs ?? 0}ms</div></div>
        </div>
        <div class="provider-table panel">
          <div class="label">Provider comparison</div>
          <table>
            <thead>
              <tr>
                <th>Provider</th><th>Input cost</th><th>Output cost</th><th>Latency</th><th>Monthly usage</th><th>Yearly usage</th><th>Savings after optimization</th>
              </tr>
            </thead>
            <tbody>
              ${providerRows || `<tr><td colspan="7" class="empty">No provider pricing configured. Add promptguard.providerPricing in settings.</td></tr>`}
            </tbody>
          </table>
        </div>
      </body>
      </html>`;
  }

  private money(value: number): string {
    return `$${value.toFixed(6)}`;
  }
}