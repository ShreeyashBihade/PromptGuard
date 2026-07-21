import * as path from "node:path";
import { promises as fs } from "node:fs";
import type { PromptHistoryEntry, PromptOptimizationLedger } from "../../types";
import type { PromptBudgetFile } from "../budget/promptBudgetService";
import type { PromptBenchmarkReport } from "../benchmarks/promptBenchmarkService";
import type { LearningSummary } from "../learning/promptLearningService";
import type { PromptPolicyFile } from "../policy/promptPolicyService";

export interface PromptAuditExportInput {
  readonly workspaceName: string;
  readonly history: readonly PromptHistoryEntry[];
  readonly ledger: PromptOptimizationLedger;
  readonly policy?: PromptPolicyFile;
  readonly budget?: PromptBudgetFile;
  readonly templateCount: number;
  readonly learning?: LearningSummary;
  readonly benchmarks?: PromptBenchmarkReport;
}

export interface PromptAuditTeamAnalytics {
  readonly promptCount: number;
  readonly averageScore?: number;
  readonly averageEstimatedSavings?: number;
  readonly totalReducedTokens: number;
  readonly totalEstimatedSavingsUsd: number;
  readonly sourceCounts: Readonly<Record<string, number>>;
}

export interface PromptAuditExportReport {
  readonly generatedAt: string;
  readonly workspaceName: string;
  readonly analytics: PromptAuditTeamAnalytics;
  readonly policyRuleCount?: number;
  readonly budgetName?: string;
  readonly templateCount: number;
  readonly learningSignals?: number;
  readonly benchmarkSummary?: { suiteCount: number; caseCount: number; passedCount: number; failedCount: number; averageScore?: number };
  readonly recentEntries: readonly PromptHistoryEntry[];
}

const EXPORT_DIR = ".promptguard/audit-reports";

export class PromptAuditExportService {
  build(input: PromptAuditExportInput): PromptAuditExportReport {
    const analytics = this.analytics(input.history, input.ledger);
    return { generatedAt: new Date().toISOString(), workspaceName: input.workspaceName, analytics, policyRuleCount: input.policy?.rules.length, budgetName: input.budget?.name, templateCount: input.templateCount, learningSignals: input.learning?.signalCount, benchmarkSummary: input.benchmarks ? { suiteCount: input.benchmarks.suiteCount, caseCount: input.benchmarks.caseCount, passedCount: input.benchmarks.passedCount, failedCount: input.benchmarks.failedCount, averageScore: input.benchmarks.averageScore } : undefined, recentEntries: [...input.history].slice(0, 10) };
  }

  renderMarkdown(report: PromptAuditExportReport): string {
    const lines: string[] = [];
    lines.push(`# PromptGuard Audit Export`);
    lines.push(``);
    lines.push(`- Workspace: ${report.workspaceName}`);
    lines.push(`- Generated: ${report.generatedAt}`);
    lines.push(`- Prompt count: ${report.analytics.promptCount}`);
    lines.push(`- Average score: ${report.analytics.averageScore?.toFixed(1) ?? "n/a"}`);
    lines.push(`- Average estimated savings: ${report.analytics.averageEstimatedSavings?.toFixed(1) ?? "n/a"}`);
    lines.push(`- Total reduced tokens: ${report.analytics.totalReducedTokens}`);
    lines.push(`- Total estimated savings: $${report.analytics.totalEstimatedSavingsUsd.toFixed(6)}`);
    lines.push(``);
    lines.push(`## Team Analytics`);
    for (const [source, count] of Object.entries(report.analytics.sourceCounts)) lines.push(`- ${source}: ${count}`);
    if (!Object.keys(report.analytics.sourceCounts).length) lines.push(`- No optimization entries yet.`);
    lines.push(``);
    lines.push(`## Workspace Controls`);
    lines.push(`- Policy rules: ${report.policyRuleCount ?? 0}`);
    lines.push(`- Budget profile: ${report.budgetName ?? "not loaded"}`);
    lines.push(`- Prompt templates: ${report.templateCount}`);
    lines.push(`- Learning signals: ${report.learningSignals ?? 0}`);
    if (report.benchmarkSummary) {
      lines.push(`- Benchmark suites: ${report.benchmarkSummary.suiteCount}`);
      lines.push(`- Benchmark cases: ${report.benchmarkSummary.caseCount}`);
      lines.push(`- Benchmark pass rate: ${report.benchmarkSummary.caseCount ? ((report.benchmarkSummary.passedCount / report.benchmarkSummary.caseCount) * 100).toFixed(1) : "0.0"}%`);
    }
    lines.push(``);
    lines.push(`## Recent Activity`);
    if (!report.recentEntries.length) {
      lines.push(`- No history entries recorded yet.`);
    } else {
      for (const entry of report.recentEntries) lines.push(`- ${new Date(entry.timestamp).toLocaleString()} | score ${entry.score} | savings ${entry.estimatedSavings.toFixed(6)} | ${this.preview(entry.originalPrompt)}`);
    }
    return `${lines.join("\n")}\n`;
  }

  async save(workspaceRoot: string | undefined, report: PromptAuditExportReport): Promise<string | undefined> {
    if (!workspaceRoot) return undefined;
    const fileName = `audit-${report.generatedAt.replace(/[:.]/g, "-")}.md`;
    const filePath = path.join(workspaceRoot, EXPORT_DIR, fileName);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, this.renderMarkdown(report), "utf8");
    return filePath;
  }

  private analytics(history: readonly PromptHistoryEntry[], ledger: PromptOptimizationLedger): PromptAuditTeamAnalytics {
    const promptCount = history.length;
    const averageScore = promptCount ? history.reduce((total, entry) => total + entry.score, 0) / promptCount : undefined;
    const averageEstimatedSavings = promptCount ? history.reduce((total, entry) => total + entry.estimatedSavings, 0) / promptCount : undefined;
    const sourceCounts: Record<string, number> = {};
    for (const entry of ledger.entries) sourceCounts[entry.source] = (sourceCounts[entry.source] ?? 0) + 1;
    return { promptCount, averageScore, averageEstimatedSavings, totalReducedTokens: ledger.totals.totalReducedTokens, totalEstimatedSavingsUsd: ledger.totals.totalEstimatedSavingsUsd, sourceCounts };
  }

  private preview(prompt: string): string {
    const cleaned = prompt.replace(/\s+/g, " ").trim();
    return cleaned.length <= 96 ? cleaned : `${cleaned.slice(0, 93)}...`;
  }
}

export {};
