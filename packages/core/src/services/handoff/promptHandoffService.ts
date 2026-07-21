import * as path from "node:path";
import { promises as fs } from "node:fs";

export interface PromptHandoffArtifact {
  readonly generatedAt: string;
  readonly title: string;
  readonly prompt: string;
  readonly source: string;
  readonly target: "browser" | "jetbrains";
  readonly nextSteps?: readonly string[];
}

export interface PromptHandoffExportReport {
  readonly artifact: PromptHandoffArtifact;
  readonly jsonPath: string;
  readonly htmlPath: string;
}

const DEFAULT_DIR = ".promptguard/handoffs";

export class PromptHandoffService {
  async export(workspaceRoot: string | undefined, artifact: PromptHandoffArtifact): Promise<PromptHandoffExportReport | undefined> {
    if (!workspaceRoot) return undefined;
    const enrichedArtifact: PromptHandoffArtifact = artifact.nextSteps ? artifact : { ...artifact, nextSteps: this.nextStepsForTarget(artifact.target) };
    const slug = artifact.generatedAt.replace(/[:.]/g, "-");
    const basePath = path.join(workspaceRoot, DEFAULT_DIR, `${slug}-${artifact.target}`);
    const jsonPath = `${basePath}.json`;
    const htmlPath = `${basePath}.html`;
    await fs.mkdir(path.dirname(basePath), { recursive: true });
    await fs.writeFile(jsonPath, JSON.stringify(enrichedArtifact, null, 2), "utf8");
    await fs.writeFile(htmlPath, this.renderHtml(enrichedArtifact), "utf8");
    return { artifact: enrichedArtifact, jsonPath, htmlPath };
  }

  renderHtml(artifact: PromptHandoffArtifact): string {
    const encodedPrompt = this.escapeHtml(artifact.prompt);
    const encodedSource = this.escapeHtml(artifact.source);
    const encodedTitle = this.escapeHtml(artifact.title);
    const nextSteps = artifact.nextSteps?.length ? `<h2>Next steps</h2><ul>${artifact.nextSteps.map(step => `<li>${this.escapeHtml(step)}</li>`).join("")}</ul>` : "";
    const bridgeSnippet = this.renderBridgeSnippet(artifact.target);
    return `<!doctype html>
      <html>
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <title>${encodedTitle}</title>
          <style>
            body { font-family: system-ui, sans-serif; margin: 0; padding: 24px; max-width: 860px; }
            .card { border: 1px solid #d0d7de; border-radius: 14px; padding: 18px; }
            pre { white-space: pre-wrap; word-break: break-word; background: #f6f8fa; padding: 14px; border-radius: 12px; }
            .meta { color: #57606a; font-size: 0.92rem; }
            .tag { display: inline-block; margin-right: 8px; padding: 4px 8px; border-radius: 999px; background: #dbeafe; color: #1e3a8a; font-size: 0.8rem; }
          </style>
        </head>
        <body>
          <div class="card">
            <h1>${encodedTitle}</h1>
            <div class="meta">
              <span class="tag">${artifact.target}</span>
              <span>${encodedSource}</span>
              <span>·</span>
              <span>${artifact.generatedAt}</span>
            </div>
            <h2>Prompt</h2>
            <pre>${encodedPrompt}</pre>
            ${bridgeSnippet}
            ${nextSteps}
          </div>
        </body>
      </html>`;
  }

  private renderBridgeSnippet(target: "browser" | "jetbrains"): string {
    const label = target === "browser" ? "Browser extension bootstrap" : "JetBrains plugin bootstrap";
    const snippet = target === "browser"
      ? ["const artifact = JSON.parse(await fs.readFile(jsonPath, 'utf8'));", "const prompt = artifact.prompt;", "await navigator.clipboard.writeText(prompt);"]
      : ["val artifact = jacksonObjectMapper().readValue<PromptHandoffArtifact>(jsonFile)", "val prompt = artifact.prompt", "clipboardManager.setContents(StringSelection(prompt))"];
    return `<h2>${label}</h2><pre><code>${this.escapeHtml(snippet.join("\n"))}</code></pre>`;
  }

  private nextStepsForTarget(target: "browser" | "jetbrains"): readonly string[] {
    return target === "browser"
      ? ["Wrap PromptGuard analysis in a browser-side compose box or extension popup.", "Load the exported JSON artifact to prefill prompt text, source, and metadata.", "Call the local PromptGuard analyzer or bridge service before sending the prompt."]
      : ["Wrap PromptGuard analysis in a JetBrains tool window or editor action.", "Load the exported JSON artifact to restore prompt text, source, and metadata.", "Call the local PromptGuard analyzer or bridge service before inserting the prompt."];
  }

  private escapeHtml(value: string): string {
    return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
}
