import * as vscode from "vscode";

const SESSION_KEY = "promptguard.cloud.session";
const PROJECT_KEY = "promptguard.cloud.project";
const CONSENT_KEY = "promptguard.cloud.consent";

interface Session { accessToken: string; expiresAt: string; userId: string; email: string; }
interface Project { id: string; name: string; }
interface VerificationResponse { accessToken: string; expiresAt: string; user: { id: string; email: string }; }

/** Client for the separate PromptGuard API. No database credentials are present in the extension. */
export class PromptGuardApi {
  constructor(private readonly context: vscode.ExtensionContext) {}

  async beginOnboarding(): Promise<boolean> {
    if (!this.baseUrl) return false;
    if (!await this.hasConsent()) return false;
    if (!await this.ensureSession()) return false;
    try { await this.project(); return true; } catch (error) { this.reportError(error); return false; }
  }

  async recordOriginalPrompt(originalPrompt: string): Promise<string | undefined> {
    if (!await this.beginOnboarding()) return undefined;
    try {
      const project = await this.project();
      const created = await this.post<{ id: string }>("/v1/prompts", { projectId: project.id, originalPrompt, modifiedPrompt: null }, true);
      return created.id;
    } catch (error) { this.reportError(error); return undefined; }
  }

  async recordModifiedPrompt(promptId: string | undefined, modifiedPrompt: string): Promise<void> {
    if (!promptId || !this.baseUrl) return;
    try { await this.request(`/v1/prompts/${encodeURIComponent(promptId)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ modifiedPrompt }) }, true); }
    catch (error) { this.reportError(error); }
  }

  private get baseUrl(): string { return vscode.workspace.getConfiguration("promptguard").get<string>("apiBaseUrl", "").trim().replace(/\/$/, ""); }
  private async hasConsent(): Promise<boolean> {
    const stored = this.context.globalState.get<boolean>(CONSENT_KEY);
    if (stored !== undefined) return stored;
    const choice = await vscode.window.showInformationMessage(
      "PromptGuard can collect your email address, project name, original prompts, and improved prompts to provide cloud prompt history. Do you consent to this collection?",
      { modal: true }, "Allow", "Not now"
    );
    const allowed = choice === "Allow";
    await this.context.globalState.update(CONSENT_KEY, allowed);
    return allowed;
  }
  private async ensureSession(): Promise<boolean> {
    const session = await this.session();
    if (session && new Date(session.expiresAt).getTime() > Date.now() + 30_000) return true;
    const verified = await this.verifyInPanel();
    if (!verified) return false;
    await this.context.secrets.store(SESSION_KEY, JSON.stringify({ accessToken: verified.accessToken, expiresAt: verified.expiresAt, userId: verified.user.id, email: verified.user.email } satisfies Session));
    return true;
  }
  private async verifyInPanel(): Promise<VerificationResponse | undefined> {
    return new Promise(resolve => {
      const panel = vscode.window.createWebviewPanel("promptguard.verify", "PromptGuard: Verify email", vscode.ViewColumn.Active, { enableScripts: true, retainContextWhenHidden: true });
      let finished = false;
      const finish = (result: VerificationResponse | undefined): void => { if (finished) return; finished = true; resolve(result); panel.dispose(); };
      panel.onDidDispose(() => { if (!finished) { finished = true; resolve(undefined); } });
      panel.webview.onDidReceiveMessage(async (message: unknown) => {
        if (!this.isVerificationMessage(message)) return;
        if (message.type === "requestCode") {
          try { await this.post("/v1/auth/request-code", { email: message.email }); panel.webview.html = this.otpHtml(message.email); }
          catch (error) { panel.webview.html = this.emailHtml(error instanceof Error ? error.message : "Unable to send the code.", message.email); }
          return;
        }
        try { finish(await this.post<VerificationResponse>("/v1/auth/verify-code", { email: message.email, code: message.code })); }
        catch (error) { panel.webview.html = this.otpHtml(message.email, error instanceof Error ? error.message : "The code could not be verified."); }
      });
      panel.webview.html = this.emailHtml();
    });
  }
  private isVerificationMessage(message: unknown): message is { type: "requestCode"; email: string } | { type: "verifyCode"; email: string; code: string } {
    if (typeof message !== "object" || message === null) return false;
    const value = message as { type?: unknown; email?: unknown; code?: unknown };
    return (value.type === "requestCode" && typeof value.email === "string") || (value.type === "verifyCode" && typeof value.email === "string" && typeof value.code === "string");
  }
  private emailHtml(error = "", email = ""): string {
    const data = JSON.stringify(email).replace(/</g, "\\u003c"); const safeError = JSON.stringify(error).replace(/</g, "\\u003c");
    return this.verificationHtml(`
      <h1>Set up PromptGuard</h1><p>Enter your email address and we’ll send a six-digit verification code.</p><p id="error" role="alert"></p>
      <form id="form"><label>Email address<input id="email" type="email" required autocomplete="email" autofocus></label><button>Send verification code</button></form>
      <script>const email=${data},error=${safeError};document.getElementById('email').value=email;document.getElementById('error').textContent=error;document.getElementById('form').onsubmit=e=>{e.preventDefault();const value=document.getElementById('email').value.trim();if(value)acquireVsCodeApi().postMessage({type:'requestCode',email:value})}</script>`);
  }
  private otpHtml(email: string, error = ""): string {
    const emailData = JSON.stringify(email).replace(/</g, "\\u003c"); const errorData = JSON.stringify(error).replace(/</g, "\\u003c");
    return this.verificationHtml(`
      <h1>Verify your email</h1><p>We sent a six-digit code to <strong id="email"></strong>. You can switch tabs or applications to retrieve it; this screen will stay open.</p><p id="error" role="alert"></p>
      <form id="form"><label>Verification code<input id="code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" required autofocus></label><button>Verify and continue</button></form>
      <script>const email=${emailData},error=${errorData};document.getElementById('email').textContent=email;document.getElementById('error').textContent=error;document.getElementById('form').onsubmit=e=>{e.preventDefault();const code=document.getElementById('code').value.trim();if(/^\\d{6}$/.test(code))acquireVsCodeApi().postMessage({type:'verifyCode',email,code})}</script>`);
  }
  private verificationHtml(body: string): string { return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';"><style>body{font-family:var(--vscode-font-family);padding:28px;max-width:520px}label{display:block;font-weight:600;margin:18px 0 8px}input{box-sizing:border-box;display:block;width:100%;margin-top:7px;padding:9px;font:inherit;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border)}button{margin-top:16px;padding:9px 14px;border:0;border-radius:4px;background:var(--vscode-button-background);color:var(--vscode-button-foreground);font:inherit}#error{color:var(--vscode-errorForeground);min-height:1.3em}</style></head><body>${body}</body></html>`; }
  private async project(): Promise<Project> {
    const selected = this.context.workspaceState.get<Project>(PROJECT_KEY);
    if (selected) return selected;
    const projects = await this.get<Array<Project & { createdAt: string }>>("/v1/projects", true);
    const picked = await vscode.window.showQuickPick([...projects.map(project => ({ label: project.name, project })), { label: "$(add) Create a project" }], { placeHolder: "Select a project context for your prompts" });
    if (!picked) throw new Error("Project selection was cancelled");
    const project = "project" in picked ? picked.project : await this.createProject();
    await this.context.workspaceState.update(PROJECT_KEY, project);
    return project;
  }
  private async createProject(): Promise<Project> {
    const name = await vscode.window.showInputBox({ prompt: "Enter a project context for the prompts you send to PromptGuard", value: vscode.workspace.name ?? "Default project", validateInput: value => value.trim().length > 0 && value.trim().length <= 100 ? undefined : "Project name must be 1–100 characters." });
    if (!name) throw new Error("Project creation was cancelled");
    return this.post<Project>("/v1/projects", { name: name.trim() }, true);
  }
  private async session(): Promise<Session | undefined> { const raw = await this.context.secrets.get(SESSION_KEY); if (!raw) return undefined; try { return JSON.parse(raw) as Session; } catch { await this.context.secrets.delete(SESSION_KEY); return undefined; } }
  private async get<T>(path: string, authenticated = false): Promise<T> { return this.request<T>(path, { method: "GET" }, authenticated); }
  private async post<T = void>(path: string, body: unknown, authenticated = false): Promise<T> { return this.request<T>(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }, authenticated); }
  private async request<T>(path: string, init: RequestInit, authenticated: boolean): Promise<T> {
    const session = authenticated ? await this.session() : undefined;
    const response = await fetch(`${this.baseUrl}${path}`, { ...init, headers: { ...init.headers, ...(session ? { Authorization: `Bearer ${session.accessToken}` } : {}) } });
    if (!response.ok) { if (response.status === 401) await this.context.secrets.delete(SESSION_KEY); const body = await response.json().catch(() => undefined) as { message?: string } | undefined; throw new Error(body?.message ?? `API request failed (${response.status})`); }
    return response.status === 204 ? undefined as T : await response.json() as T;
  }
  private reportError(error: unknown): void { console.warn(`PromptGuard API: ${error instanceof Error ? error.message : "Unknown error"}`); }
}
