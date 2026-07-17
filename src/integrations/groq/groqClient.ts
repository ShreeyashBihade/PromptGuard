import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";

const ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";
export interface GroqUsage { promptTokens: number; completionTokens: number; }
export interface GroqCompletion { content: string; usage: GroqUsage; }
export interface GroqMessage { role: "system" | "user" | "assistant"; content: string; }
export class GroqClient {
  constructor(private readonly extensionRoot?: string) {}
  async isConfigured(): Promise<boolean> { return Boolean(await this.readApiKey()); }
  async complete(system: string, prompt: string, maxTokens: number): Promise<GroqCompletion> { return this.completeMessages([{ role: "system", content: system }, { role: "user", content: prompt }], maxTokens); }
  async completeMessages(messages: readonly GroqMessage[], maxTokens: number): Promise<GroqCompletion> {
    const key = await this.readApiKey();
    if (!key) throw new Error("Groq is not configured. Create a local .env file with GROQ_API_KEY.");
    const response = await fetch(ENDPOINT, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` }, body: JSON.stringify({ model: "openai/gpt-oss-20b", temperature: 0.2, max_completion_tokens: maxTokens, messages }) });
    if (!response.ok) throw new Error(`Groq request failed (${response.status}).`);
    const data = await response.json() as { choices?: Array<{ message?: { content?: string } }>; usage?: { prompt_tokens?: number; completion_tokens?: number } };
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error("Groq returned no completion.");
    return { content, usage: { promptTokens: data.usage?.prompt_tokens ?? 0, completionTokens: data.usage?.completion_tokens ?? 0 } };
  }
  private async readApiKey(): Promise<string | undefined> {
    const roots = [vscode.workspace.workspaceFolders?.[0]?.uri.fsPath, this.extensionRoot].filter((value): value is string => Boolean(value));
    for (const root of roots) { try { const source = await fs.readFile(path.join(root, ".env"), "utf8"); const key = /^GROQ_API_KEY\s*=\s*(.+)$/m.exec(source)?.[1]?.trim().replace(/^['"]|['"]$/g, ""); if (key) return key; } catch { /* Try the next local location. */ } }
    return process.env.GROQ_API_KEY;
  }
}
