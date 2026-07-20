import * as vscode from "vscode";
import * as path from "node:path";
import { promises as fs } from "node:fs";
import { PromptOptimizationLedger, PromptOptimizationLedgerEntry, PromptOptimizationLedgerTotals } from "../types";

const LEDGER_DIR = ".promptguard";
const LEDGER_FILE = "prompt-optimizations.json";
const BACKUP_DIR = "backups";
const BACKUP_PREFIX = "prompt-optimizations";
const MAX_BACKUPS = 5;
const MAX_ENTRIES = 1000;

export class OptimizationLedgerStore {
  private cached?: PromptOptimizationLedger;

  async record(entry: Omit<PromptOptimizationLedgerEntry, "id" | "timestamp" | "reducedTokens" | "reductionPercent">): Promise<PromptOptimizationLedger> {
    const ledger = await this.read();
    const reducedTokens = Math.max(0, entry.inputTokens - entry.outputTokens);
    const reductionPercent = entry.inputTokens > 0 ? Number(((reducedTokens / entry.inputTokens) * 100).toFixed(2)) : 0;
    const fullEntry: PromptOptimizationLedgerEntry = {
      ...entry,
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date().toISOString(),
      reducedTokens,
      reductionPercent
    };

    const entries = [fullEntry, ...ledger.entries].slice(0, MAX_ENTRIES);
    const totals = this.computeTotals(entries, entry.projectName);
    const updated: PromptOptimizationLedger = {
      version: 1,
      updatedAt: new Date().toISOString(),
      totals,
      entries
    };

    await this.write(updated);
    this.cached = updated;
    return updated;
  }

  async snapshot(): Promise<PromptOptimizationLedger> {
    if (this.cached) return this.cached;
    const ledger = await this.read();
    this.cached = ledger;
    return ledger;
  }

  async clear(): Promise<void> {
    const file = this.ledgerFilePath();
    await fs.rm(file, { force: true });
    await fs.rm(this.backupsDirPath(), { recursive: true, force: true });
    this.cached = undefined;
  }

  private computeTotals(entries: PromptOptimizationLedgerEntry[], projectName: string): PromptOptimizationLedgerTotals {
    const totals = entries.reduce((acc, entry) => {
      acc.totalEntries += 1;
      acc.totalInputTokens += entry.inputTokens;
      acc.totalOutputTokens += entry.outputTokens;
      acc.totalReducedTokens += entry.reducedTokens;
      acc.totalEstimatedSavingsUsd += entry.estimatedSavingsUsd;
      acc.averageReductionPercent += entry.reductionPercent;
      return acc;
    }, {
      projectName,
      totalEntries: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalReducedTokens: 0,
      totalEstimatedSavingsUsd: 0,
      averageReductionPercent: 0
    } satisfies PromptOptimizationLedgerTotals);

    if (totals.totalEntries > 0) {
      totals.averageReductionPercent = Number((totals.averageReductionPercent / totals.totalEntries).toFixed(2));
      totals.totalEstimatedSavingsUsd = Number(totals.totalEstimatedSavingsUsd.toFixed(6));
    }

    return totals;
  }

  private async read(): Promise<PromptOptimizationLedger> {
    try {
      const file = this.ledgerFilePath();
      const raw = await fs.readFile(file, "utf8");
      const parsed = JSON.parse(raw) as PromptOptimizationLedger;
      if (parsed.version !== 1 || !Array.isArray(parsed.entries) || !parsed.totals) throw new Error("Invalid ledger format");
      return parsed;
    } catch {
      return {
        version: 1,
        updatedAt: new Date().toISOString(),
        totals: {
          projectName: this.defaultProjectName(),
          totalEntries: 0,
          totalInputTokens: 0,
          totalOutputTokens: 0,
          totalReducedTokens: 0,
          totalEstimatedSavingsUsd: 0,
          averageReductionPercent: 0
        },
        entries: []
      };
    }
  }

  private async write(ledger: PromptOptimizationLedger): Promise<void> {
    const file = this.ledgerFilePath();
    await fs.mkdir(path.dirname(file), { recursive: true });
    await this.backupCurrentFile(file);
    await fs.writeFile(file, `${JSON.stringify(ledger, null, 2)}\n`, "utf8");
  }

  private async backupCurrentFile(file: string): Promise<void> {
    try {
      await fs.access(file);
    } catch {
      return;
    }

    const backupsDir = this.backupsDirPath();
    await fs.mkdir(backupsDir, { recursive: true });

    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupFile = path.join(backupsDir, `${BACKUP_PREFIX}-${stamp}.json`);
    await fs.copyFile(file, backupFile);
    await this.trimBackups(backupsDir);
  }

  private async trimBackups(backupsDir: string): Promise<void> {
    const files = await fs.readdir(backupsDir);
    const backups = files.filter(name => name.startsWith(`${BACKUP_PREFIX}-`) && name.endsWith(".json")).sort().reverse();
    if (backups.length <= MAX_BACKUPS) return;
    const stale = backups.slice(MAX_BACKUPS);
    await Promise.all(stale.map(name => fs.rm(path.join(backupsDir, name), { force: true })));
  }

  private ledgerFilePath(): string {
    const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (folder) return path.join(folder, LEDGER_DIR, LEDGER_FILE);
    const fallback = process.cwd();
    return path.join(fallback, LEDGER_DIR, LEDGER_FILE);
  }

  private backupsDirPath(): string {
    const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (folder) return path.join(folder, LEDGER_DIR, BACKUP_DIR);
    const fallback = process.cwd();
    return path.join(fallback, LEDGER_DIR, BACKUP_DIR);
  }

  private defaultProjectName(): string {
    return vscode.workspace.workspaceFolders?.[0]?.name ?? vscode.workspace.name ?? "workspace";
  }
}
