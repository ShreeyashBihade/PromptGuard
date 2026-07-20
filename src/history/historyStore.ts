import * as vscode from "vscode";
import { PromptHistoryEntry } from "../types";
const KEY = "promptguard.history";
export class HistoryStore {
  constructor(private readonly state: vscode.Memento) {}
  list(query = ""): PromptHistoryEntry[] { const entries = this.state.get<PromptHistoryEntry[]>(KEY, []); const q=query.toLowerCase(); return entries.filter(entry => !q || entry.originalPrompt.toLowerCase().includes(q)).sort((a,b) => b.timestamp.localeCompare(a.timestamp)); }
  async add(entry: PromptHistoryEntry): Promise<void> { await this.state.update(KEY, [entry, ...this.list()].slice(0, 250)); }
  async clear(): Promise<void> { await this.state.update(KEY, []); }
}
