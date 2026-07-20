import * as vscode from "vscode";
import { randomUUID } from "node:crypto";

const SESSION_KEY = "promptguard.cloud.session";
const PROJECT_KEY = "promptguard.cloud.project";
const CONSENT_KEY = "promptguard.cloud.consent";
const CONSENT_POLICY_KEY = "promptguard.cloud.consentPolicyVersion";

interface Session { accessToken: string; expiresAt: string; userId: string; email: string; }
interface Project { id: string; name: string; }
interface VerificationResponse { accessToken: string; expiresAt: string; user: { id: string; email: string }; }
class ApiRequestError extends Error { constructor(readonly status: number, message: string) { super(message); } }

export type OnboardingStage =
  | "api-unconfigured"
  | "consent-denied"
  | "session-cancelled"
  | "session-ready"
  | "policy-recorded"
  | "project-ready"
  | "api-error";

export interface OnboardingResult {
  allowed: boolean;
  stage: OnboardingStage;
  message: string;
  httpStatus?: number;
}

/** Client for the separate PromptGuard API. No database credentials are present in the extension. */
export class PromptGuardApi {
  constructor(private readonly context: vscode.ExtensionContext) {}

  async logout(): Promise<void> {
    await this.context.secrets.delete(SESSION_KEY);
    await this.context.workspaceState.update(PROJECT_KEY, undefined);
  }

  async deleteAccount(): Promise<void> {
    try {
      await this.request("/v1/account", { method: "DELETE" }, true);
    } catch (error) {
      this.reportError(error);
    }
    await this.resetOnboardingState();
  }

  async resetOnboardingState(): Promise<void> {
    await this.context.secrets.delete(SESSION_KEY);
    await this.context.workspaceState.update(PROJECT_KEY, undefined);
    await this.context.globalState.update(CONSENT_KEY, undefined);
    await this.context.globalState.update(CONSENT_POLICY_KEY, undefined);
  }

  async beginOnboarding(): Promise<boolean> {
    return (await this.beginOnboardingDetailed()).allowed;
  }

  async beginOnboardingDetailed(options: { forceConsentPrompt?: boolean } = {}): Promise<OnboardingResult> {
    if (!this.baseUrl) return { allowed: false, stage: "api-unconfigured", message: "PromptGuard API URL is not configured." };
    if (!await this.hasConsent(options.forceConsentPrompt ?? false)) return { allowed: false, stage: "consent-denied", message: "Data-collection consent was not granted." };
    if (!await this.ensureSession()) return { allowed: false, stage: "session-cancelled", message: "Email verification was cancelled or did not complete." };
    try {
      await this.ensureConsentRecorded();
    } catch (error) {
      const details = this.errorDetails(error);
      this.reportError(error);
      return { allowed: false, stage: "api-error", message: `Unable to record consent policy (${details.message}).`, httpStatus: details.httpStatus };
    }

    try {
      await this.project();
    } catch (error) {
      const details = this.errorDetails(error);
      this.reportError(error);
      return { allowed: false, stage: "api-error", message: `Unable to resolve project context (${details.message}).`, httpStatus: details.httpStatus };
    }

    return { allowed: true, stage: "project-ready", message: "Onboarding complete." };
  }

  /** Mandatory preflight before a prompt can be forwarded to Groq. */
  async authorizeGroqForwarding(): Promise<boolean> { return this.beginOnboarding(); }

  /** Detailed preflight status used by deterministic onboarding state tracking and tracing. */
  async authorizeGroqForwardingDetailed(): Promise<OnboardingResult> { return this.beginOnboardingDetailed(); }

  /** Manual onboarding kickoff used when a user wants to retry login/consent explicitly. */
  async startOnboardingDetailed(): Promise<OnboardingResult> { return this.beginOnboardingDetailed({ forceConsentPrompt: true }); }

  async recordOriginalPrompt(originalPrompt: string): Promise<string | undefined> {
    const onboarding = await this.beginOnboardingDetailed();
    if (!onboarding.allowed) return undefined;
    try {
      const project = await this.project();
      const created = await this.requestWithRetry<{ id: string }>("/v1/prompts", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": randomUUID() }, body: JSON.stringify({ projectId: project.id, originalPrompt, modifiedPrompt: null }) }, true);
      return created.id;
    } catch (error) { this.reportError(error); return undefined; }
  }

  async recordModifiedPrompt(promptId: string | undefined, modifiedPrompt: string): Promise<void> {
    if (!promptId || !this.baseUrl) return;
    try { await this.request(`/v1/prompts/${encodeURIComponent(promptId)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ modifiedPrompt }) }, true); }
    catch (error) { this.reportError(error); }
  }

  private get baseUrl(): string { return vscode.workspace.getConfiguration("promptguard").get<string>("apiBaseUrl", "").trim().replace(/\/$/, ""); }
  private async hasConsent(forcePrompt = false): Promise<boolean> {
    const stored = this.context.globalState.get<boolean>(CONSENT_KEY);
    if (stored === true) return true;
    if (stored === false && !forcePrompt) return false;
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
    await this.context.globalState.update(CONSENT_POLICY_KEY, this.policyVersion);
    return true;
  }
  private get policyVersion(): string { return vscode.workspace.getConfiguration("promptguard").get<string>("dataCollectionPolicyVersion", "2026-07-19"); }
  private async ensureConsentRecorded(): Promise<void> {
    if (this.context.globalState.get<string>(CONSENT_POLICY_KEY) === this.policyVersion) return;
    await this.post("/v1/account/consent", { policyVersion: this.policyVersion }, true);
    await this.context.globalState.update(CONSENT_POLICY_KEY, this.policyVersion);
  }
  private async verifyInPanel(): Promise<VerificationResponse | undefined> {
    return new Promise(resolve => {
      const panel = vscode.window.createWebviewPanel("promptguard.verify", "PromptGuard: Verify email", vscode.ViewColumn.Active, { enableScripts: true, retainContextWhenHidden: true });
      let finished = false;
      let verifiedSession: VerificationResponse | undefined;
      const defaultProjectName = this.defaultProjectName();
      const finish = (result: VerificationResponse | undefined): void => { if (finished) return; finished = true; resolve(result); panel.dispose(); };
      panel.onDidDispose(() => { if (!finished) { finished = true; resolve(undefined); } });
      panel.webview.onDidReceiveMessage(async (message: unknown) => {
        if (!this.isVerificationMessage(message)) return;
        if (message.type === "requestCode") {
          try { await this.post("/v1/auth/request-code", { email: message.email }); panel.webview.html = this.otpHtml(message.email); }
          catch (error) { panel.webview.html = this.emailHtml(error instanceof Error ? error.message : "Unable to send the code.", message.email); }
          return;
        }
        if (message.type === "verifyCode") {
          try {
            verifiedSession = await this.post<VerificationResponse>("/v1/auth/verify-code", { email: message.email, code: message.code, consent: { policyVersion: this.policyVersion } });
            await this.context.secrets.store(SESSION_KEY, JSON.stringify({ accessToken: verifiedSession.accessToken, expiresAt: verifiedSession.expiresAt, userId: verifiedSession.user.id, email: verifiedSession.user.email } satisfies Session));
            panel.webview.html = this.projectHtml(message.email, defaultProjectName);
          }
          catch (error) { panel.webview.html = this.otpHtml(message.email, error instanceof Error ? error.message : "The code could not be verified."); }
          return;
        }
        if (message.type === "submitProject") {
          try {
            const project = await this.createProject(message.projectName);
            await this.context.workspaceState.update(PROJECT_KEY, project);
            finish(verifiedSession ?? undefined);
          }
          catch (error) { panel.webview.html = this.projectHtml(message.email, message.projectName, error instanceof Error ? error.message : "The project name could not be saved."); }
        }
      });
      panel.webview.html = this.emailHtml();
    });
  }
  private isVerificationMessage(message: unknown): message is { type: "requestCode"; email: string } | { type: "verifyCode"; email: string; code: string } | { type: "submitProject"; email: string; projectName: string } {
    if (typeof message !== "object" || message === null) return false;
    const value = message as { type?: unknown; email?: unknown; code?: unknown; projectName?: unknown };
    return (value.type === "requestCode" && typeof value.email === "string") || (value.type === "verifyCode" && typeof value.email === "string" && typeof value.code === "string") || (value.type === "submitProject" && typeof value.email === "string" && typeof value.projectName === "string");
  }
  private emailHtml(error = "", email = ""): string {
    const data = JSON.stringify(email).replace(/</g, "\\u003c"); const safeError = JSON.stringify(error).replace(/</g, "\\u003c");
    return this.verificationHtml("Step 1 of 3", "Set up PromptGuard", "Connect your email to unlock guided analysis, cloud prompt history, and Groq-powered prompt improvement before every Analyse run.", ["Every prompt you analyse is saved to the PromptGuard backend.", "Groq adds a second opinion to improve clarity and structure.", "Your workspace gets a clear onboarding flow instead of hidden setup."], `
      <p id="error" role="alert"></p>
      <form id="form">
        <label>Email address<input id="email" type="email" required autocomplete="email" autofocus></label>
        <button>Send verification code</button>
      </form>
      <script>const email=${data},error=${safeError};document.getElementById('email').value=email;document.getElementById('error').textContent=error;document.getElementById('form').onsubmit=e=>{e.preventDefault();const value=document.getElementById('email').value.trim();if(value)acquireVsCodeApi().postMessage({type:'requestCode',email:value})}</script>`);
  }
  private otpHtml(email: string, error = ""): string {
    const emailData = JSON.stringify(email).replace(/</g, "\\u003c"); const errorData = JSON.stringify(error).replace(/</g, "\\u003c");
    return this.verificationHtml("Step 2 of 3", "Verify your email", `We sent a six-digit code to <strong id="email"></strong>. This confirms your account so PromptGuard can keep your prompt history and analysis tied to you.`, ["The verification step keeps your prompt data linked to the right workspace context.", "After this, you can choose the project PromptGuard should use.", "The Analyze flow will stay gated until setup is complete."], `
      <p id="error" role="alert"></p>
      <form id="form">
        <label>Verification code<input id="code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" required autofocus></label>
        <button>Verify and continue</button>
      </form>
      <script>const email=${emailData},error=${errorData};document.getElementById('email').textContent=email;document.getElementById('error').textContent=error;document.getElementById('form').onsubmit=e=>{e.preventDefault();const code=document.getElementById('code').value.trim();if(/^\\d{6}$/.test(code))acquireVsCodeApi().postMessage({type:'verifyCode',email,code})}</script>`);
  }
  private projectHtml(email: string, projectName: string, error = ""): string {
    const emailData = JSON.stringify(email).replace(/</g, "\\u003c"); const projectData = JSON.stringify(projectName).replace(/</g, "\\u003c"); const errorData = JSON.stringify(error).replace(/</g, "\\u003c");
    return this.verificationHtml("Step 3 of 3", "Name your project", `Tell PromptGuard which project this workspace belongs to so it can organize prompt history and analysis under the right context for <strong id="email"></strong>.`, ["The project name is stored with your prompt history in the PromptGuard backend.", "You can keep the current workspace name or replace it with a more specific one.", "Once you finish this step, PromptGuard will not ask again unless you reset onboarding."], `
      <p id="error" role="alert"></p>
      <form id="form">
        <label>Project name<input id="projectName" type="text" maxlength="100" required autofocus></label>
        <button>Save project and continue</button>
      </form>
      <script>const email=${emailData},projectName=${projectData},error=${errorData};document.getElementById('email').textContent=email;document.getElementById('projectName').value=projectName;document.getElementById('error').textContent=error;document.getElementById('form').onsubmit=e=>{e.preventDefault();const value=document.getElementById('projectName').value.trim();if(value)acquireVsCodeApi().postMessage({type:'submitProject',email,projectName:value})}</script>`);
  }
  private verificationHtml(eyebrow: string, title: string, summary: string, benefits: string[], body: string): string { return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';"><style>body{margin:0;font-family:var(--vscode-font-family);color:var(--vscode-foreground);background:linear-gradient(160deg,var(--vscode-sideBar-background),var(--vscode-editor-background) 48%,var(--vscode-sideBar-background));min-height:100vh}*{box-sizing:border-box}.wrap{max-width:1060px;margin:0 auto;padding:28px 22px 36px}.hero{display:grid;grid-template-columns:1.15fr .85fr;gap:18px;align-items:stretch}.panel{border:1px solid color-mix(in srgb,var(--vscode-panel-border) 72%, transparent);background:color-mix(in srgb,var(--vscode-editor-background) 90%, transparent);backdrop-filter:blur(10px);border-radius:20px;box-shadow:0 22px 56px rgba(0,0,0,.18)}.intro{padding:28px 30px;position:relative;overflow:hidden}.intro:before{content:"";position:absolute;inset:-1px auto auto -1px;width:180px;height:180px;border-radius:999px;background:radial-gradient(circle, color-mix(in srgb,var(--vscode-button-background) 38%, transparent), transparent 70%);opacity:.85;pointer-events:none}.eyebrow{display:inline-flex;gap:8px;align-items:center;padding:7px 11px;border-radius:999px;background:color-mix(in srgb,var(--vscode-button-background) 16%, transparent);color:var(--vscode-button-foreground);font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase}.eyebrow:before{content:"";width:8px;height:8px;border-radius:999px;background:var(--vscode-button-background)}h1{margin:18px 0 10px;font-size:34px;line-height:1.05;letter-spacing:-.03em}.summary{margin:0;color:color-mix(in srgb,var(--vscode-foreground) 82%, transparent);font-size:15px;line-height:1.65;max-width:52ch}.benefits{display:grid;gap:12px;margin-top:24px}.benefit{padding:14px 14px 14px 16px;border-radius:16px;background:color-mix(in srgb,var(--vscode-editor-background) 72%, transparent);border:1px solid color-mix(in srgb,var(--vscode-panel-border) 68%, transparent)}.benefit strong{display:block;font-size:14px;margin-bottom:3px}.benefit span{color:color-mix(in srgb,var(--vscode-foreground) 74%, transparent);font-size:13px;line-height:1.55}.card{padding:24px}.steps{display:grid;gap:10px;margin-bottom:18px}.step{display:flex;align-items:center;gap:12px;padding:12px 14px;border-radius:14px;background:color-mix(in srgb,var(--vscode-editor-background) 78%, transparent);border:1px solid color-mix(in srgb,var(--vscode-panel-border) 62%, transparent)}.step b{display:inline-flex;justify-content:center;align-items:center;width:28px;height:28px;border-radius:999px;background:var(--vscode-button-background);color:var(--vscode-button-foreground);font-size:13px}.step span{font-size:13px;line-height:1.45}.form{padding:2px 0 0}label{display:block;font-weight:700;font-size:13px;margin:16px 0 8px}input{box-sizing:border-box;display:block;width:100%;margin-top:7px;padding:11px 12px;font:inherit;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border);border-radius:12px;outline:none}input:focus{border-color:var(--vscode-focusBorder);box-shadow:0 0 0 1px var(--vscode-focusBorder)}button{margin-top:18px;width:100%;padding:12px 14px;border:0;border-radius:12px;background:linear-gradient(135deg,var(--vscode-button-background),color-mix(in srgb,var(--vscode-button-background) 72%, #000 28%));color:var(--vscode-button-foreground);font:inherit;font-weight:700;cursor:pointer;box-shadow:0 10px 26px rgba(0,0,0,.18)}button:hover{filter:brightness(1.05)}#error{color:var(--vscode-errorForeground);min-height:1.3em;margin:0 0 8px;line-height:1.5}.footer{margin-top:16px;font-size:12px;color:color-mix(in srgb,var(--vscode-foreground) 68%, transparent)}@media (max-width: 860px){.hero{grid-template-columns:1fr}h1{font-size:30px}.wrap{padding:16px}}</style></head><body><div class="wrap"><div class="hero"><section class="panel intro"><div class="eyebrow">${eyebrow}</div><h1>${title}</h1><p class="summary">${summary}</p><div class="benefits">${benefits.map(benefit => { const [headline, ...rest] = benefit.split("|"); const safeHeadline = (headline ?? benefit).trim(); const detail = rest.join("|").trim(); return `<div class="benefit"><strong>${safeHeadline}</strong><span>${detail}</span></div>`; }).join("")}</div></section><section class="panel card"><div class="steps"><div class="step"><b>1</b><span>Consent, verify, and connect your prompt history to PromptGuard.</span></div><div class="step"><b>2</b><span>Choose the project context PromptGuard should attach to your prompts.</span></div><div class="step"><b>3</b><span>Run Analyse to save every prompt and get Groq-powered improvements.</span></div></div><div class="form">${body}</div><div class="footer">You can reset onboarding anytime from the command palette if you want a fresh start.</div></section></div></div></body></html>`; }
  private defaultProjectName(): string {
    return vscode.workspace.workspaceFolders?.[0]?.name ?? vscode.workspace.name ?? "Default project";
  }
  private async project(): Promise<Project> {
    const selected = this.context.workspaceState.get<Project>(PROJECT_KEY);
    if (selected) return selected;
    const project = await this.createProject();
    await this.context.workspaceState.update(PROJECT_KEY, project);
    return project;
  }
  private async createProject(name?: string): Promise<Project> {
    const projectName = name?.trim() || await vscode.window.showInputBox({ prompt: "Enter the project name PromptGuard should use for this workspace", value: this.defaultProjectName(), validateInput: value => value.trim().length > 0 && value.trim().length <= 100 ? undefined : "Project name must be 1–100 characters." });
    if (!projectName) throw new Error("Project creation was cancelled");
    const created = await this.post<Project | { _id?: string; projectId?: string; name: string }>("/v1/projects", { name: projectName }, true);
    const id = "id" in created ? created.id : created.projectId ?? created._id;
    if (!id) throw new Error("The API created a project without returning a project ID.");
    return { id, name: created.name };
  }
  private async session(): Promise<Session | undefined> { const raw = await this.context.secrets.get(SESSION_KEY); if (!raw) return undefined; try { return JSON.parse(raw) as Session; } catch { await this.context.secrets.delete(SESSION_KEY); return undefined; } }
  private async get<T>(path: string, authenticated = false): Promise<T> { return this.request<T>(path, { method: "GET" }, authenticated); }
  private async post<T = void>(path: string, body: unknown, authenticated = false): Promise<T> { return this.request<T>(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }, authenticated); }
  private async request<T>(path: string, init: RequestInit, authenticated: boolean): Promise<T> {
    const session = authenticated ? await this.session() : undefined;
    const response = await fetch(`${this.baseUrl}${path}`, { ...init, headers: { ...init.headers, ...(session ? { Authorization: `Bearer ${session.accessToken}` } : {}) } });
    if (!response.ok) { if (response.status === 401) await this.context.secrets.delete(SESSION_KEY); const body = await response.json().catch(() => undefined) as { message?: string } | undefined; throw new ApiRequestError(response.status, body?.message ?? `API request failed (${response.status})`); }
    return response.status === 204 ? undefined as T : await response.json() as T;
  }
  private async requestWithRetry<T>(path: string, init: RequestInit, authenticated: boolean): Promise<T> {
    try { return await this.request<T>(path, init, authenticated); }
    catch (error) {
      // Reuse the same key only for a transient failure. The API returns the original record if the first request succeeded.
      if (error instanceof ApiRequestError && error.status < 500) throw error;
      return this.request<T>(path, init, authenticated);
    }
  }
  private errorDetails(error: unknown): { message: string; httpStatus?: number } {
    if (error instanceof ApiRequestError) return { message: error.message, httpStatus: error.status };
    return { message: error instanceof Error ? error.message : "unknown error" };
  }
  private reportError(error: unknown): void { console.warn(`PromptGuard API: ${error instanceof Error ? error.message : "Unknown error"}`); }
}
