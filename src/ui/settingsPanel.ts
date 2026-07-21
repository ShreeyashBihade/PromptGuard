import * as vscode from "vscode";
import { AssessmentPathMode, GroqKeyMode } from "../config/settings";

const escapeHtml = (value: string): string => value
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/\"/g, "&quot;")
  .replace(/'/g, "&#39;");

export interface PromptGuardSettingsPanelState {
  readonly enabled: boolean;
  readonly analyzeOnSave: boolean;
  readonly minimumPromptLength: number;
  readonly assessmentPathMode: AssessmentPathMode;
  readonly groqKeyMode: GroqKeyMode;
  readonly enableBudgetMode: boolean;
  readonly enableLearningStore: boolean;
}

export interface PromptGuardSettingsPanelUpdate {
  readonly enabled: boolean;
  readonly analyzeOnSave: boolean;
  readonly minimumPromptLength: number;
  readonly assessmentPathMode: AssessmentPathMode;
  readonly groqKeyMode: GroqKeyMode;
  readonly enableBudgetMode: boolean;
  readonly enableLearningStore: boolean;
}

export class PromptGuardSettingsPanel {
  private panel?: vscode.WebviewPanel;
  private state?: PromptGuardSettingsPanelState;

  constructor(
    private readonly handlers: {
      readonly onSave: (update: PromptGuardSettingsPanelUpdate) => Promise<void>;
      readonly onOpenAdvanced: () => Promise<void>;
      readonly onRefreshState: () => PromptGuardSettingsPanelState;
    }
  ) {}

  show(state: PromptGuardSettingsPanelState): void {
    this.state = state;
    if (!this.panel) {
      this.panel = vscode.window.createWebviewPanel(
        "promptguard.settingsPanel",
        "PromptGuard Settings",
        vscode.ViewColumn.Beside,
        { enableScripts: true, retainContextWhenHidden: true }
      );
      this.panel.onDidDispose(() => { this.panel = undefined; });
      this.panel.webview.onDidReceiveMessage((message: unknown) => {
        void this.handleMessage(message);
      });
    } else {
      this.panel.reveal(vscode.ViewColumn.Beside);
    }

    this.panel.title = "PromptGuard Settings";
    this.render();
  }

  private async handleMessage(message: unknown): Promise<void> {
    const payload = typeof message === "object" && message !== null ? message as { type?: unknown; data?: unknown } : undefined;
    if (!payload) {
      return;
    }
    const type = payload?.type;
    if (type === "save" && payload.data && typeof payload.data === "object") {
      const data = payload.data as Record<string, unknown>;
      const update: PromptGuardSettingsPanelUpdate = {
        enabled: Boolean(data.enabled),
        analyzeOnSave: Boolean(data.analyzeOnSave),
        minimumPromptLength: Math.max(0, Number(data.minimumPromptLength) || 0),
        assessmentPathMode: this.pathMode(data.assessmentPathMode),
        groqKeyMode: this.keyMode(data.groqKeyMode),
        enableBudgetMode: Boolean(data.enableBudgetMode),
        enableLearningStore: Boolean(data.enableLearningStore)
      };

      await this.handlers.onSave(update);
      this.state = this.handlers.onRefreshState();
      this.render("Settings saved.");
      return;
    }

    if (type === "open-advanced") {
      await this.handlers.onOpenAdvanced();
      return;
    }
  }

  private pathMode(value: unknown): AssessmentPathMode {
    return value === "preferLocal" || value === "preferGroq" || value === "alwaysAsk" ? value : "alwaysAsk";
  }

  private keyMode(value: unknown): GroqKeyMode {
    return value === "workspaceThenProcessEnv" || value === "strictProjectOnly" ? value : "strictProjectOnly";
  }

  private render(status?: string): void {
    if (!this.panel || !this.state) {
      return;
    }
    this.panel.webview.html = this.html(this.state, status);
  }

  private html(state: PromptGuardSettingsPanelState, status?: string): string {
    return `<!doctype html>
      <html lang="en">
        <head>
          <meta charset="UTF-8" />
          <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <style>
            body { margin: 0; padding: 20px; font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); }
            .panel { border: 1px solid var(--vscode-widget-border); border-radius: 12px; background: var(--vscode-editorWidget-background); padding: 14px; }
            h1 { margin: 0 0 8px; }
            .muted { color: var(--vscode-descriptionForeground); }
            form { margin-top: 14px; display: grid; gap: 12px; }
            .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
            .field { display: grid; gap: 6px; }
            label { font-size: 12px; color: var(--vscode-descriptionForeground); }
            input[type="number"], select { width: 100%; border: 1px solid var(--vscode-input-border); color: var(--vscode-input-foreground); background: var(--vscode-input-background); border-radius: 8px; padding: 8px; font: inherit; }
            .toggle { display: flex; align-items: center; gap: 8px; padding: 8px 0; }
            .actions { display: flex; gap: 8px; flex-wrap: wrap; }
            button { border: 0; border-radius: 8px; padding: 8px 12px; font: inherit; cursor: pointer; color: var(--vscode-button-foreground); background: var(--vscode-button-background); }
            button.secondary { color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); }
            .status { margin-top: 10px; color: var(--vscode-descriptionForeground); }
            @media (max-width: 860px) { .grid { grid-template-columns: 1fr; } }
          </style>
        </head>
        <body>
          <section class="panel">
            <h1>PromptGuard Settings</h1>
            <p class="muted">Manage preferences and core settings without editing JSON manually.</p>
            <form id="settings-form">
              <div class="grid">
                <div class="field">
                  <label for="minimumPromptLength">Minimum prompt length</label>
                  <input id="minimumPromptLength" type="number" min="0" value="${state.minimumPromptLength}" />
                </div>
                <div class="field">
                  <label for="assessmentPathMode">Assessment path mode</label>
                  <select id="assessmentPathMode">
                    <option value="alwaysAsk" ${state.assessmentPathMode === "alwaysAsk" ? "selected" : ""}>Always ask per prompt</option>
                    <option value="preferLocal" ${state.assessmentPathMode === "preferLocal" ? "selected" : ""}>Prefer local</option>
                    <option value="preferGroq" ${state.assessmentPathMode === "preferGroq" ? "selected" : ""}>Prefer Groq</option>
                  </select>
                </div>
                <div class="field">
                  <label for="groqKeyMode">GROQ key mode</label>
                  <select id="groqKeyMode">
                    <option value="strictProjectOnly" ${state.groqKeyMode === "strictProjectOnly" ? "selected" : ""}>Strict project only</option>
                    <option value="workspaceThenProcessEnv" ${state.groqKeyMode === "workspaceThenProcessEnv" ? "selected" : ""}>Workspace then process env</option>
                  </select>
                </div>
              </div>

              <div class="grid">
                <label class="toggle"><input id="enabled" type="checkbox" ${state.enabled ? "checked" : ""} /> Enable PromptGuard analysis</label>
                <label class="toggle"><input id="analyzeOnSave" type="checkbox" ${state.analyzeOnSave ? "checked" : ""} /> Analyze on save (local)</label>
                <label class="toggle"><input id="enableBudgetMode" type="checkbox" ${state.enableBudgetMode ? "checked" : ""} /> Enable budget mode</label>
                <label class="toggle"><input id="enableLearningStore" type="checkbox" ${state.enableLearningStore ? "checked" : ""} /> Enable learning store</label>
                
              </div>

              <div class="actions">
                <button type="submit">Save settings</button>
                <button type="button" id="open-advanced" class="secondary">Open advanced settings</button>
              </div>
            </form>
            <div class="status">${escapeHtml(status ?? "Changes are written to workspace or user settings depending on context.")}</div>
          </section>
          <script>
            const vscode = acquireVsCodeApi();
            const form = document.getElementById('settings-form');
            const byId = (id) => document.getElementById(id);
            form.addEventListener('submit', event => {
              event.preventDefault();
              vscode.postMessage({
                type: 'save',
                data: {
                  enabled: byId('enabled').checked,
                  analyzeOnSave: byId('analyzeOnSave').checked,
                  minimumPromptLength: byId('minimumPromptLength').value,
                  assessmentPathMode: byId('assessmentPathMode').value,
                  groqKeyMode: byId('groqKeyMode').value,
                  enableBudgetMode: byId('enableBudgetMode').checked,
                  enableLearningStore: byId('enableLearningStore').checked
                }
              });
            });
            byId('open-advanced').addEventListener('click', () => {
              vscode.postMessage({ type: 'open-advanced' });
            });
          </script>
        </body>
      </html>`;
  }
}