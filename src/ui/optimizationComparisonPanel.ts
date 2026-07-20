import * as vscode from "vscode";

const escapeHtml = (value: string): string => value
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/\"/g, "&quot;")
  .replace(/'/g, "&#39;");

export class OptimizationComparisonPanel {
  private panel?: vscode.WebviewPanel;

  show(originalPrompt: string, optimizedPrompt: string): void {
    if (!this.panel) {
      this.panel = vscode.window.createWebviewPanel(
        "promptguard.optimize.compare",
        "PromptGuard Optimization Compare",
        vscode.ViewColumn.Beside,
        { enableScripts: true, retainContextWhenHidden: true }
      );
      this.panel.onDidDispose(() => { this.panel = undefined; });
      this.panel.webview.onDidReceiveMessage(async (message: unknown) => {
        const type = typeof message === "object" && message !== null ? (message as { type?: unknown }).type : undefined;
        if (type === "copy-optimized") {
          await vscode.env.clipboard.writeText(optimizedPrompt);
          void vscode.window.showInformationMessage("PromptGuard: optimized prompt copied to clipboard.");
        }
      });
    }

    this.panel.title = "PromptGuard Optimization Compare";
    this.panel.webview.html = this.html(originalPrompt, optimizedPrompt);
    this.panel.reveal(vscode.ViewColumn.Beside);
  }

  private html(originalPrompt: string, optimizedPrompt: string): string {
    const safeOriginal = escapeHtml(originalPrompt);
    const safeOptimized = escapeHtml(optimizedPrompt);
    return `<!doctype html>
      <html>
        <head>
          <meta charset="UTF-8">
          <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
          <style>
            body { margin: 0; padding: 20px; font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); }
            .head { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 12px; }
            h1 { margin: 0; font-size: 18px; }
            .hint { margin: 0; color: var(--vscode-descriptionForeground); font-size: 12px; }
            .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
            .card { border: 1px solid var(--vscode-widget-border); border-radius: 10px; padding: 12px; background: var(--vscode-editorWidget-background); }
            .label { margin: 0 0 8px; font-size: 12px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--vscode-descriptionForeground); }
            pre { margin: 0; white-space: pre-wrap; word-break: break-word; min-height: 280px; max-height: 65vh; overflow: auto; background: var(--vscode-textCodeBlock-background); border-radius: 8px; padding: 10px; }
            button { border: 0; border-radius: 8px; padding: 8px 12px; font: inherit; cursor: pointer; color: var(--vscode-button-foreground); background: var(--vscode-button-background); }
            button:hover { filter: brightness(1.06); }
            @media (max-width: 980px) { .grid { grid-template-columns: 1fr; } }
          </style>
        </head>
        <body>
          <div class="head">
            <div>
              <h1>Prompt comparison</h1>
              <p class="hint">Review token-optimized output and copy it directly.</p>
            </div>
            <button id="copy">Copy optimized prompt</button>
          </div>
          <div class="grid">
            <section class="card">
              <p class="label">Original prompt</p>
              <pre>${safeOriginal}</pre>
            </section>
            <section class="card">
              <p class="label">Optimized prompt</p>
              <pre>${safeOptimized}</pre>
            </section>
          </div>
          <script>
            const vscode = acquireVsCodeApi();
            document.getElementById('copy').addEventListener('click', () => vscode.postMessage({ type: 'copy-optimized' }));
          </script>
        </body>
      </html>`;
  }
}
