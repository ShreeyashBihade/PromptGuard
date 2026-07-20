const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

export class OnboardingDialogs {
  emailHtml(error = "", email = ""): string {
    const data = JSON.stringify(email).replace(/</g, "\\u003c");
    const safeError = JSON.stringify(error).replace(/</g, "\\u003c");
    return this.verificationHtml("Step 1 of 3", "Set up PromptGuard", "Connect your email to unlock guided analysis, cloud prompt history, and Groq-powered prompt improvement before every Analyse run.", ["Every prompt you analyse is saved to the PromptGuard backend.", "Groq adds a second opinion to improve clarity and structure.", "Your workspace gets a clear onboarding flow instead of hidden setup."], `
      <p id="error" role="alert"></p>
      <form id="form">
        <label>Email address<input id="email" type="email" required autocomplete="email" autofocus></label>
        <button>Send verification code</button>
      </form>
      <script>const email=${data},error=${safeError};document.getElementById('email').value=email;document.getElementById('error').textContent=error;document.getElementById('form').onsubmit=e=>{e.preventDefault();const value=document.getElementById('email').value.trim();if(value)acquireVsCodeApi().postMessage({type:'requestCode',email:value})}</script>`);
  }

  otpHtml(email: string, error = ""): string {
    const emailData = JSON.stringify(email).replace(/</g, "\\u003c");
    const errorData = JSON.stringify(error).replace(/</g, "\\u003c");
    return this.verificationHtml("Step 2 of 3", "Verify your email", `We sent a six-digit code to <strong id="email"></strong>. This confirms your account so PromptGuard can keep your prompt history and analysis tied to you.`, ["The verification step keeps your prompt data linked to the right workspace context.", "After this, you can choose the project PromptGuard should use.", "The Analyze flow will stay gated until setup is complete."], `
      <p id="error" role="alert"></p>
      <form id="form">
        <label>Verification code<input id="code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" required autofocus></label>
        <button>Verify and continue</button>
      </form>
      <script>const email=${emailData},error=${errorData};document.getElementById('email').textContent=email;document.getElementById('error').textContent=error;document.getElementById('form').onsubmit=e=>{e.preventDefault();const code=document.getElementById('code').value.trim();if(/^\\d{6}$/.test(code))acquireVsCodeApi().postMessage({type:'verifyCode',email,code})}</script>`);
  }

  projectHtml(email: string, projectName: string, error = ""): string {
    const emailData = JSON.stringify(email).replace(/</g, "\\u003c");
    const projectData = JSON.stringify(projectName).replace(/</g, "\\u003c");
    const errorData = JSON.stringify(error).replace(/</g, "\\u003c");
    return this.verificationHtml("Step 3 of 3", "Name your project", `Tell PromptGuard which project this workspace belongs to so it can organize prompt history and analysis under the right context for <strong id="email"></strong>.`, ["The project name is stored with your prompt history in the PromptGuard backend.", "You can keep the current workspace name or replace it with a more specific one.", "Once you finish this step, PromptGuard will not ask again unless you reset onboarding."], `
      <p id="error" role="alert"></p>
      <form id="form">
        <label>Project name<input id="projectName" type="text" maxlength="100" required autofocus></label>
        <button>Save project and continue</button>
      </form>
      <script>const email=${emailData},projectName=${projectData},error=${errorData};document.getElementById('email').textContent=email;document.getElementById('projectName').value=projectName;document.getElementById('error').textContent=error;document.getElementById('form').onsubmit=e=>{e.preventDefault();const value=document.getElementById('projectName').value.trim();if(value)acquireVsCodeApi().postMessage({type:'submitProject',email,projectName:value})}</script>`);
  }

  loadingHtml(text: string): string {
    return `<!doctype html><body style="font-family:var(--vscode-font-family);padding:24px"><h2>PromptGuard</h2><p>${escapeHtml(text)}</p></body>`;
  }

  private verificationHtml(eyebrow: string, title: string, summary: string, benefits: string[], body: string): string {
    return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';"><style>body{margin:0;font-family:var(--vscode-font-family);color:var(--vscode-foreground);background:linear-gradient(160deg,var(--vscode-sideBar-background),var(--vscode-editor-background) 48%,var(--vscode-sideBar-background));min-height:100vh}*{box-sizing:border-box}.wrap{max-width:1060px;margin:0 auto;padding:28px 22px 36px}.hero{display:grid;grid-template-columns:1.15fr .85fr;gap:18px;align-items:stretch}.panel{border:1px solid color-mix(in srgb,var(--vscode-panel-border) 72%, transparent);background:color-mix(in srgb,var(--vscode-editor-background) 90%, transparent);backdrop-filter:blur(10px);border-radius:20px;box-shadow:0 22px 56px rgba(0,0,0,.18)}.intro{padding:28px 30px;position:relative;overflow:hidden}.intro:before{content:"";position:absolute;inset:-1px auto auto -1px;width:180px;height:180px;border-radius:999px;background:radial-gradient(circle, color-mix(in srgb,var(--vscode-button-background) 38%, transparent), transparent 70%);opacity:.85;pointer-events:none}.eyebrow{display:inline-flex;gap:8px;align-items:center;padding:7px 11px;border-radius:999px;background:color-mix(in srgb,var(--vscode-button-background) 16%, transparent);color:var(--vscode-button-foreground);font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase}.eyebrow:before{content:"";width:8px;height:8px;border-radius:999px;background:var(--vscode-button-background)}h1{margin:18px 0 10px;font-size:34px;line-height:1.05;letter-spacing:-.03em}.summary{margin:0;color:color-mix(in srgb,var(--vscode-foreground) 82%, transparent);font-size:15px;line-height:1.65;max-width:52ch}.benefits{display:grid;gap:12px;margin-top:24px}.benefit{padding:14px 14px 14px 16px;border-radius:16px;background:color-mix(in srgb,var(--vscode-editor-background) 70%, transparent);border:1px solid color-mix(in srgb,var(--vscode-widget-border) 68%, transparent);color:var(--vscode-foreground);line-height:1.5}.form{padding:28px}.field{display:grid;gap:8px;margin-bottom:16px}label{font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--vscode-descriptionForeground)}input{width:100%;padding:14px 16px;border-radius:14px;border:1px solid var(--vscode-input-border);background:var(--vscode-input-background);color:var(--vscode-input-foreground);font:inherit;outline:none}input:focus{border-color:var(--vscode-focusBorder);box-shadow:0 0 0 3px color-mix(in srgb,var(--vscode-focusBorder) 20%, transparent)}button{width:100%;margin-top:10px;padding:14px 16px;border:none;border-radius:14px;background:linear-gradient(135deg,var(--vscode-button-background),color-mix(in srgb,var(--vscode-button-background) 75%, #36d399 25%));color:var(--vscode-button-foreground);font-weight:700;font-size:15px;cursor:pointer;box-shadow:0 14px 28px rgba(31,156,207,.28)}button:hover{filter:brightness(1.03)}.error{min-height:22px;margin:0 0 16px;color:var(--vscode-errorForeground)}.foot{margin-top:16px;color:var(--vscode-descriptionForeground);font-size:12px;line-height:1.5}@media (max-width:860px){.hero{grid-template-columns:1fr}.intro,.form{padding:22px}}@keyframes fade-in{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}</style></head><body><div class="wrap"><div class="hero"><section class="panel intro"><span class="eyebrow">${escapeHtml(eyebrow)}</span><h1>${escapeHtml(title)}</h1><p class="summary">${summary}</p><div class="benefits">${benefits.map(benefit => `<div class="benefit">${escapeHtml(benefit)}</div>`).join("")}</div></section><section class="panel form">${body}<p class="foot">PromptGuard keeps onboarding deterministic and local until you explicitly connect the cloud workflow.</p></section></div></div></body></html>`;
  }
}