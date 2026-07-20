import * as vscode from "vscode";
import { PromptAnalyticsService } from "../services/analytics/promptAnalyticsService";
import { AnalysisResult, PromptHistoryEntry, PromptOptimizationLedger } from "../types";

const nonce = (): string => Math.random().toString(36).slice(2);

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

export class Dashboard {
  private panel?: vscode.WebviewPanel;
  private readonly analytics = new PromptAnalyticsService();

  constructor(private readonly extensionUri: vscode.Uri, private readonly onAction: (action: "cleanup" | "expand" | "minimize" | "logout" | "delete" | "new-project" | "switch-project") => void) {}

  show(result: AnalysisResult | undefined, history: PromptHistoryEntry[], ledger?: PromptOptimizationLedger): void {
    if (!this.panel) {
      this.panel = vscode.window.createWebviewPanel("promptguard.dashboard", "PromptGuard Dashboard", vscode.ViewColumn.Beside, { enableScripts: true, retainContextWhenHidden: true });
      this.panel.onDidDispose(() => { this.panel = undefined; });
      this.panel.webview.onDidReceiveMessage((message: unknown) => {
        const type = typeof message === "object" && message !== null ? (message as { type?: unknown }).type : undefined;
        if (type === "cleanup" || type === "expand" || type === "minimize" || type === "logout" || type === "delete" || type === "new-project" || type === "switch-project") this.onAction(type);
      });
    }
    this.panel.webview.html = this.html(this.panel.webview, result, history, ledger);
    this.panel.reveal();
  }

  private html(webview: vscode.Webview, result: AnalysisResult | undefined, history: PromptHistoryEntry[], ledger?: PromptOptimizationLedger): string {
    const csp = nonce();
    const score = result?.score.total ?? 0;
    const issues = result?.issues ?? [];
    const breakdown = result?.score.breakdown;
    const chartUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "node_modules", "chart.js", "dist", "chart.umd.js"));
    const status = escapeHtml(result?.groqStatus ?? "Analyze a prompt to populate your dashboard.");
    const qualitySource = result?.scoreSource === "groq" ? "Groq-led" : "Local";
    const bestPractices = result?.localInsights?.bestPractices ?? [];
    const modelRecommendations = result?.localInsights?.recommendations ?? [];
    const totals = ledger?.totals;
    const entries = ledger?.entries ?? [];
    const analytics = this.analytics.build(history, result);
    const latest = entries.slice(0, 8).map(entry => `
      <tr>
        <td>${escapeHtml(new Date(entry.timestamp).toLocaleDateString())}</td>
        <td>${escapeHtml(entry.source)}</td>
        <td>${entry.inputTokens}</td>
        <td>${entry.outputTokens}</td>
        <td>${entry.reducedTokens}</td>
        <td>${entry.reductionPercent.toFixed(1)}%</td>
      </tr>`).join("") || `<tr><td colspan="6" class="muted">No optimization entries yet. Analyze a prompt to start tracking.</td></tr>`;
    const money = (value: number | undefined): string => value === undefined ? "$0.000000" : `$${value.toFixed(6)}`;
    const nextMilestone = Math.ceil(((totals?.totalReducedTokens ?? 0) + 1) / 1000) * 1000;
    const milestoneProgress = nextMilestone > 0 ? Math.min(100, ((totals?.totalReducedTokens ?? 0) / nextMilestone) * 100) : 0;
    const trendEntries = [...entries].slice(0, 10).reverse();
    const analyticsTrendLabels = analytics.recentSamples.map(sample => escapeHtml(new Date(sample.timestamp).toLocaleDateString()));
    const analyticsTrendQuality = analytics.recentSamples.map(sample => sample.quality);
    const analyticsTrendCost = analytics.recentSamples.map(sample => sample.estimatedCostUsd);
    const analyticsTrendSavings = analytics.recentSamples.map(sample => sample.optimizationSavingsUsd);
    const analyticsAverageLabels = ["Tokens", "Ambiguity", "Redundancy", "Quality", "Savings", "Cost"];
    const analyticsAverageValues = [analytics.averageTokens, analytics.averageAmbiguity, analytics.averageRedundancy, analytics.averageQuality, analytics.averageOptimizationSavingsUsd, analytics.averageCostUsd];
    const issueHtml = issues.length
      ? issues.slice(0, 6).map((issue, index) => `
        <article class="issue" style="--delay:${index + 2};">
          <h3>${escapeHtml(issue.title)}</h3>
          <p>${escapeHtml(issue.suggestedFix)}</p>
        </article>`).join("")
      : "<p class=\"muted\">No active findings.</p>";

    return `<!doctype html>
      <html>
        <head>
          <meta charset="UTF-8">
          <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src ${webview.cspSource} 'nonce-${csp}';">
          <style>
            :root {
              --surface: var(--vscode-editorWidget-background);
              --surface-alt: color-mix(in srgb, var(--vscode-sideBar-background) 82%, #0e2633 18%);
              --ink: var(--vscode-foreground);
              --muted: var(--vscode-descriptionForeground);
              --line: color-mix(in srgb, var(--vscode-widget-border) 70%, #23556d 30%);
              --accent: #1f9ccf;
              --accent-soft: rgba(31, 156, 207, 0.2);
              --warm: #f3a948;
            }

            * { box-sizing: border-box; }

            body {
              margin: 0;
              padding: 30px;
              min-height: 100vh;
              color: var(--ink);
              font-family: "Bahnschrift", "Segoe UI Variable Text", "Trebuchet MS", var(--vscode-font-family);
              background:
                radial-gradient(1200px 500px at 100% 0%, rgba(31, 156, 207, 0.16), transparent 60%),
                radial-gradient(900px 400px at 0% 100%, rgba(243, 169, 72, 0.12), transparent 60%),
                var(--vscode-editor-background);
            }

            .shell {
              max-width: 1180px;
              margin: 0 auto;
              animation: fade-in 280ms ease-out;
            }

            .hero {
              display: grid;
              gap: 20px;
              grid-template-columns: 1fr auto;
              padding: 24px;
              border-radius: 18px;
              border: 1px solid var(--line);
              background: linear-gradient(135deg, color-mix(in srgb, var(--surface) 75%, #193445 25%), var(--surface));
              box-shadow: 0 16px 28px rgba(0, 0, 0, 0.18);
            }

            .brand {
              letter-spacing: 0.12em;
              text-transform: uppercase;
              font-size: 12px;
              color: var(--warm);
              margin-bottom: 8px;
            }

            h1 {
              margin: 0;
              font-size: clamp(1.45rem, 2vw, 2rem);
              line-height: 1.22;
              font-weight: 700;
            }

            .muted {
              color: var(--muted);
            }

            .status {
              margin: 12px 0 0;
              line-height: 1.45;
            }

            .score-block {
              min-width: 220px;
              align-self: end;
              text-align: right;
            }

            .score-label {
              font-size: 12px;
              letter-spacing: 0.07em;
              text-transform: uppercase;
              color: var(--muted);
            }

            .score {
              font-size: clamp(44px, 6vw, 66px);
              line-height: 1;
              font-weight: 800;
              margin-top: 6px;
              color: color-mix(in srgb, var(--ink) 90%, #b6ecff 10%);
            }

            .actions {
              display: flex;
              flex-wrap: nowrap;
              overflow-x: auto;
              gap: 10px;
              margin-top: 18px;
              padding-bottom: 4px;
            }

            .actions button {
              flex: 0 0 auto;
              white-space: nowrap;
            }

            button {
              appearance: none;
              border: 1px solid transparent;
              border-radius: 999px;
              padding: 9px 15px;
              font: inherit;
              font-weight: 600;
              color: #fff;
              background: linear-gradient(90deg, #1578a4, #1f9ccf);
              cursor: pointer;
              transition: transform 140ms ease, filter 140ms ease;
            }

            button:hover {
              transform: translateY(-1px);
              filter: brightness(1.08);
            }

            button.secondary {
              background: color-mix(in srgb, var(--vscode-button-secondaryBackground) 80%, #203744 20%);
              color: var(--vscode-button-secondaryForeground);
              border-color: var(--line);
            }

            .grid {
              margin-top: 16px;
              display: grid;
              grid-template-columns: repeat(4, minmax(170px, 1fr));
              gap: 12px;
            }

            .analytics-grid {
              margin-top: 16px;
              display: grid;
              grid-template-columns: repeat(6, minmax(120px, 1fr));
              gap: 12px;
            }

            .stat,
            .panel {
              border-radius: 14px;
              border: 1px solid var(--line);
              background: linear-gradient(180deg, var(--surface-alt), var(--surface));
              box-shadow: 0 12px 20px rgba(0, 0, 0, 0.14);
              animation: lift-in 220ms ease-out;
            }

            .stat {
              padding: 14px 16px;
            }

            .stat .label {
              font-size: 12px;
              text-transform: uppercase;
              letter-spacing: 0.06em;
              color: var(--muted);
            }

            .stat .value {
              margin-top: 6px;
              font-size: 26px;
              font-weight: 700;
              color: color-mix(in srgb, var(--ink) 90%, #c7f2ff 10%);
            }

            .two {
              margin-top: 14px;
              display: grid;
              grid-template-columns: 1.1fr 0.9fr;
              gap: 14px;
            }

            .history-panel {
              margin-top: 14px;
            }

            .momentum {
              display: grid;
              gap: 12px;
            }

            .milestone {
              border: 1px solid var(--line);
              border-radius: 12px;
              padding: 10px 12px;
              background: color-mix(in srgb, var(--surface-alt) 82%, #1a3140 18%);
            }

            .milestone strong {
              font-size: 14px;
            }

            .progress {
              margin-top: 8px;
              width: 100%;
              height: 10px;
              border-radius: 999px;
              background: rgba(160, 200, 220, 0.18);
              overflow: hidden;
            }

            .progress > span {
              display: block;
              height: 100%;
              width: 0;
              background: linear-gradient(90deg, #1f9ccf, #5ad3f5);
            }

            .chips {
              display: flex;
              flex-wrap: wrap;
              gap: 8px;
              margin-bottom: 8px;
            }

            .chip {
              border: 1px solid var(--line);
              border-radius: 999px;
              padding: 6px 10px;
              font-size: 11px;
              color: color-mix(in srgb, var(--ink) 90%, #d5f5ff 10%);
              background: color-mix(in srgb, var(--surface-alt) 80%, #112634 20%);
            }

            table {
              width: 100%;
              border-collapse: collapse;
              font-size: 12px;
            }

            th, td {
              text-align: left;
              padding: 8px 6px;
              border-bottom: 1px solid var(--line);
            }

            th {
              color: var(--muted);
              text-transform: uppercase;
              letter-spacing: 0.05em;
              font-size: 11px;
            }

            .panel {
              padding: 16px;
            }

            .panel h2 {
              margin: 0 0 12px;
              font-size: 16px;
            }

            .chart-frame {
              height: 260px;
            }

            .chart-frame canvas {
              width: 100% !important;
              height: 100% !important;
            }

            .analytics-table {
              margin-top: 14px;
            }

            .issue {
              --delay: 1;
              padding: 10px 0;
              border-bottom: 1px solid var(--line);
              animation: fade-slide 260ms ease-out both;
              animation-delay: calc(var(--delay) * 45ms);
            }

            .issue:last-child {
              border-bottom: 0;
            }

            .issue h3 {
              margin: 0 0 4px;
              font-size: 13px;
            }

            .issue p {
              margin: 0;
              color: var(--muted);
              line-height: 1.35;
            }

            @keyframes fade-in {
              from { opacity: 0; transform: translateY(4px); }
              to { opacity: 1; transform: translateY(0); }
            }

            @keyframes lift-in {
              from { opacity: 0; transform: translateY(6px); }
              to { opacity: 1; transform: translateY(0); }
            }

            @keyframes fade-slide {
              from { opacity: 0; transform: translateX(-4px); }
              to { opacity: 1; transform: translateX(0); }
            }

            @media (max-width: 980px) {
              .hero {
                grid-template-columns: 1fr;
              }

              .score-block {
                text-align: left;
              }

              .grid {
                grid-template-columns: repeat(2, minmax(170px, 1fr));
              }

              .two {
                grid-template-columns: 1fr;
              }

              .analytics-grid {
                grid-template-columns: repeat(3, minmax(120px, 1fr));
              }
            }

            @media (max-width: 640px) {
              body { padding: 16px; }
              .grid { grid-template-columns: 1fr; }
              .analytics-grid { grid-template-columns: repeat(2, minmax(120px, 1fr)); }
            }
          </style>
        </head>
        <body>
          <main class="shell">
            <section class="hero">
              <div>
                <div class="brand">PromptGuard - Prompt Governance</div>
                <h1>Prompt intelligence with clear guardrails and measurable outcomes.</h1>
                <p class="status muted">${status}</p>
                <div class="actions">
                  <button id="switch-project" class="secondary">Switch project</button>
                  <button id="new-project" class="secondary">New project</button>
                  <button id="cleanup" class="secondary">Offline safe cleanup</button>
                  <button id="expand">Expand prompt</button>
                  <button id="minimize" class="secondary">Minimize token usage</button>
                  <button id="logout" class="secondary">Logout</button>
                  <button id="delete" class="secondary">Delete data</button>
                </div>
              </div>
              <aside class="score-block">
                <div class="score-label">Quality score - ${qualitySource}</div>
                <div class="score">${score}/100</div>
              </aside>
            </section>

            <section class="analytics-grid">
              <article class="stat"><div class="label">Average tokens</div><div class="value">${analytics.averageTokens.toFixed(1)}</div></article>
              <article class="stat"><div class="label">Average ambiguity</div><div class="value">${analytics.averageAmbiguity.toFixed(1)}%</div></article>
              <article class="stat"><div class="label">Average redundancy</div><div class="value">${analytics.averageRedundancy.toFixed(1)}%</div></article>
              <article class="stat"><div class="label">Average quality</div><div class="value">${analytics.averageQuality.toFixed(1)}</div></article>
              <article class="stat"><div class="label">Average savings</div><div class="value">${money(analytics.averageOptimizationSavingsUsd)}</div></article>
              <article class="stat"><div class="label">Average cost</div><div class="value">${money(analytics.averageCostUsd)}</div></article>
            </section>

            <section class="two">
              <article class="panel">
                <h2>Average metrics</h2>
                <div class="chart-frame"><canvas id="analyticsAverageChart"></canvas></div>
              </article>
              <article class="panel">
                <h2>Trend lines</h2>
                <div class="chart-frame"><canvas id="analyticsTrendChart"></canvas></div>
              </article>
            </section>

            <section class="panel analytics-table">
              <h2>Recent analytics samples</h2>
              <table>
                <thead>
                  <tr>
                    <th>Prompt</th>
                    <th>Tokens</th>
                    <th>Ambiguity</th>
                    <th>Redundancy</th>
                    <th>Quality</th>
                    <th>Savings</th>
                    <th>Cost</th>
                  </tr>
                </thead>
                <tbody>
                  ${analytics.recentSamples.length ? analytics.recentSamples.map(sample => `
                    <tr>
                      <td>${escapeHtml(sample.label)}<div class="muted">${escapeHtml(new Date(sample.timestamp).toLocaleDateString())}</div></td>
                      <td>${sample.inputTokens}</td>
                      <td>${sample.ambiguity.toFixed(1)}%</td>
                      <td>${sample.redundancy.toFixed(1)}%</td>
                      <td>${sample.quality.toFixed(1)}</td>
                      <td>${money(sample.optimizationSavingsUsd)}</td>
                      <td>${money(sample.estimatedCostUsd)}</td>
                    </tr>`).join("") : `<tr><td colspan="7" class="muted">No analytics samples yet. Analyze a prompt to generate trends and charts.</td></tr>`}
                </tbody>
              </table>
            </section>

            <section class="grid">
              <article class="stat"><div class="label">Input tokens (current)</div><div class="value">${result?.cost.inputTokens ?? 0}</div></article>
              <article class="stat"><div class="label">Reduced tokens (project)</div><div class="value">${totals?.totalReducedTokens ?? 0}</div></article>
              <article class="stat"><div class="label">Estimated latency (ms)</div><div class="value">${result?.cost.estimatedLatencyMs ?? 0}</div></article>
              <article class="stat"><div class="label">Optimization entries</div><div class="value">${totals?.totalEntries ?? history.length}</div></article>
            </section>

            <section class="grid">
              <article class="stat"><div class="label">Project</div><div class="value">${escapeHtml(totals?.projectName ?? "workspace")}</div></article>
              <article class="stat"><div class="label">Input tokens (project)</div><div class="value">${totals?.totalInputTokens ?? 0}</div></article>
              <article class="stat"><div class="label">Output tokens (project)</div><div class="value">${totals?.totalOutputTokens ?? 0}</div></article>
              <article class="stat"><div class="label">Estimated savings (USD)</div><div class="value">${money(totals?.totalEstimatedSavingsUsd)}</div></article>
            </section>

            <section class="two">
              <article class="panel">
                <h2>Optimization momentum</h2>
                <div class="momentum">
                  <canvas id="momentumChart"></canvas>
                  <div class="milestone">
                    <strong>Next token-reduction milestone: ${nextMilestone.toLocaleString()}</strong>
                    <p class="muted">You have reduced ${(totals?.totalReducedTokens ?? 0).toLocaleString()} tokens so far across this project.</p>
                    <div class="progress"><span style="width:${milestoneProgress.toFixed(1)}%"></span></div>
                  </div>
                </div>
              </article>
              <article class="panel">
                <h2>Top findings</h2>
                ${issueHtml}
              </article>
            </section>

            <section class="two">
              <article class="panel">
                <h2>Local best practices</h2>
                ${bestPractices.length ? `<div class="chips">${bestPractices.map(practice => `<span class="chip">${escapeHtml(practice)}</span>`).join("")}</div>` : `<p class="muted">Run a prompt analysis to generate local best-practice guidance.</p>`}
              </article>
              <article class="panel">
                <h2>Suggested models (local knowledge)</h2>
                ${modelRecommendations.length ? modelRecommendations.map(rec => `<article class="issue"><h3>${escapeHtml(rec.provider)}/${escapeHtml(rec.model)} (${escapeHtml(rec.fit)})</h3><p>${escapeHtml(rec.rationale)}</p></article>`).join("") : `<p class="muted">No model recommendations yet.</p>`}
              </article>
            </section>

            <section class="panel history-panel">
              <h2>Optimization history and token deltas</h2>
              <p class="muted">Average reduction: ${totals?.averageReductionPercent?.toFixed(1) ?? "0.0"}% · Ledger file: .promptguard/prompt-optimizations.json</p>
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Source</th>
                    <th>Input</th>
                    <th>Output</th>
                    <th>Reduced</th>
                    <th>Delta</th>
                  </tr>
                </thead>
                <tbody>${latest}</tbody>
              </table>
            </section>
          </main>

          <script nonce="${csp}" src="${chartUri}"></script>
          <script nonce="${csp}">
            const vscode = acquireVsCodeApi();
            ["switch-project", "new-project", "cleanup", "expand", "minimize", "logout", "delete"].forEach(type => {
              const el = document.getElementById(type);
              if (el) el.addEventListener("click", () => vscode.postMessage({ type }));
            });

            const momentumLabels = ${JSON.stringify(trendEntries.map(entry => new Date(entry.timestamp).toLocaleDateString()))};
            const momentumValues = ${JSON.stringify(trendEntries.map(entry => entry.reducedTokens))};
            if (momentumLabels.length) {
              new Chart(document.getElementById("momentumChart"), {
                type: "bar",
                data: {
                  labels: momentumLabels,
                  datasets: [{
                    label: "Reduced tokens",
                    data: momentumValues,
                    borderColor: "#1f9ccf",
                    backgroundColor: "rgba(31, 156, 207, 0.48)",
                    pointBackgroundColor: "#f3a948",
                    borderWidth: 2
                  }]
                },
                options: {
                  plugins: { legend: { display: false } }
                }
              });
            }

            const analyticsAverageLabels = ${JSON.stringify(analyticsAverageLabels)};
            const analyticsAverageValues = ${JSON.stringify(analyticsAverageValues)};
            const analyticsTrendLabels = ${JSON.stringify(analyticsTrendLabels)};
            const analyticsTrendQuality = ${JSON.stringify(analyticsTrendQuality)};
            const analyticsTrendCost = ${JSON.stringify(analyticsTrendCost)};
            const analyticsTrendSavings = ${JSON.stringify(analyticsTrendSavings)};

            if (analyticsAverageLabels.length) {
              new Chart(document.getElementById("analyticsAverageChart"), {
                type: "bar",
                data: {
                  labels: analyticsAverageLabels,
                  datasets: [{
                    label: "Average",
                    data: analyticsAverageValues,
                    backgroundColor: ["rgba(31, 156, 207, 0.55)", "rgba(243, 169, 72, 0.55)", "rgba(245, 158, 11, 0.55)", "rgba(90, 211, 245, 0.55)", "rgba(34, 197, 94, 0.55)", "rgba(220, 38, 38, 0.55)"]
                  }]
                },
                options: {
                  responsive: true,
                  maintainAspectRatio: false,
                  plugins: { legend: { display: false } },
                  scales: {
                    y: { beginAtZero: true }
                  }
                }
              });
            }

            if (analyticsTrendLabels.length) {
              new Chart(document.getElementById("analyticsTrendChart"), {
                type: "line",
                data: {
                  labels: analyticsTrendLabels,
                  datasets: [
                    {
                      label: "Quality",
                      data: analyticsTrendQuality,
                      borderColor: "#1f9ccf",
                      backgroundColor: "rgba(31, 156, 207, 0.18)",
                      yAxisID: "quality",
                      tension: 0.25
                    },
                    {
                      label: "Cost",
                      data: analyticsTrendCost,
                      borderColor: "#f3a948",
                      backgroundColor: "rgba(243, 169, 72, 0.18)",
                      yAxisID: "cost",
                      tension: 0.25
                    },
                    {
                      label: "Savings",
                      data: analyticsTrendSavings,
                      borderColor: "#5ad3f5",
                      backgroundColor: "rgba(90, 211, 245, 0.18)",
                      yAxisID: "cost",
                      tension: 0.25
                    }
                  ]
                },
                options: {
                  responsive: true,
                  maintainAspectRatio: false,
                  scales: {
                    quality: {
                      beginAtZero: true,
                      max: 100,
                      position: "left"
                    },
                    cost: {
                      beginAtZero: true,
                      position: "right",
                      grid: { drawOnChartArea: false }
                    }
                  }
                }
              });
            }
          </script>
        </body>
      </html>`;
  }
}
