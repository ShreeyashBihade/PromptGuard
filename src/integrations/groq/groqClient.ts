import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";
import { GroqKeyMode } from "../../config/settings";

const ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";
export interface GroqUsage { promptTokens: number; completionTokens: number; }
export interface GroqCompletion { content: string; usage: GroqUsage; }
export interface GroqMessage { role: "system" | "user" | "assistant"; content: string; }
export interface GroqKeyStatus { configured: boolean; source: "project-env" | "workspace-env" | "process-env" | "none"; mode: GroqKeyMode; }
export class GroqClient {
  constructor(private readonly workspaceState?: vscode.Memento) {}
  async isConfigured(): Promise<boolean> { return Boolean(await this.readApiKey()); }
  async keyStatus(): Promise<GroqKeyStatus> {
    const mode = this.mode();
    const resolved = await this.resolveApiKey();
    return { configured: Boolean(resolved?.key), source: resolved?.source ?? "none", mode };
  }
  async complete(system: string, prompt: string, maxTokens: number): Promise<GroqCompletion> { return this.completeMessages([{ role: "system", content: system }, { role: "user", content: prompt }], maxTokens); }
  async completeMessages(messages: readonly GroqMessage[], maxTokens: number): Promise<GroqCompletion> {
    const key = await this.readApiKey();
    if (!key) throw new Error("Groq is not configured. Create a local .env file with GROQ_API_KEY.");
    const primary = await this.request(key, "openai/gpt-oss-20b", messages, maxTokens);
    if (primary) return primary;
    const retry = await this.request(key, "llama-3.3-70b-versatile", messages, maxTokens);
    if (retry) return retry;
    throw new Error("Groq returned an empty response after retrying. Try again shortly.");
  }
  private async request(key: string, model: string, messages: readonly GroqMessage[], maxTokens: number): Promise<GroqCompletion | undefined> {
    const response = await fetch(ENDPOINT, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` }, body: JSON.stringify({ model, temperature: 0.2, max_completion_tokens: maxTokens, messages }) });
    if (!response.ok) throw new Error(`Groq request failed (${response.status}).`);
    const data = await response.json() as { choices?: Array<{ text?: string; message?: { content?: string | Array<{ text?: string; content?: string }> } }>; usage?: { prompt_tokens?: number; completion_tokens?: number } };
    const raw = data.choices?.[0]?.message?.content;
    const content = typeof raw === "string" ? raw : Array.isArray(raw) ? raw.map(part => part.text ?? part.content ?? "").join("") : data.choices?.[0]?.text;
    if (!content?.trim()) return undefined;
    return { content, usage: { promptTokens: data.usage?.prompt_tokens ?? 0, completionTokens: data.usage?.completion_tokens ?? 0 } };
  }
  private mode(): GroqKeyMode {
    return vscode.workspace.getConfiguration("promptguard").get<GroqKeyMode>("groqKeyMode", "strictProjectOnly");
  }
  private async resolveApiKey(): Promise<{ key: string; source: GroqKeyStatus["source"] } | undefined> {
    const mode = this.mode();
    const projectFolder = this.workspaceState?.get<string>("promptguard.cloud.projectFolder");
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const roots = [projectFolder, mode === "workspaceThenProcessEnv" ? workspaceFolder : undefined].filter((value, index, self): value is string => Boolean(value) && self.indexOf(value) === index);
    for (const root of roots) {
      try {
        const source = await fs.readFile(path.join(root, ".env"), "utf8");
        const key = /^GROQ_API_KEY\s*=\s*(.+)$/m.exec(source)?.[1]?.trim().replace(/^['"]|['"]$/g, "");
        if (!key) continue;
        const sourceLabel: GroqKeyStatus["source"] = projectFolder && root === projectFolder ? "project-env" : "workspace-env";
        return { key, source: sourceLabel };
      } catch {
        // Try next location.
      }
    }

    if (mode === "workspaceThenProcessEnv") {
      const envKey = process.env.GROQ_API_KEY?.trim();
      if (envKey) return { key: envKey, source: "process-env" };
    }

    return undefined;
  }
  private async readApiKey(): Promise<string | undefined> {
    return (await this.resolveApiKey())?.key;
  }
}
