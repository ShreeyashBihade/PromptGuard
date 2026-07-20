import * as fs from "fs";
import * as path from "path";
import { AnalysisResult, PromptIssue } from "../../types";

export type LearningOptimizationOutcome = "accepted" | "rejected";

export interface LearningSignal {
  readonly timestamp: string;
  readonly source: "analyze" | "optimize" | "refine-cleanup" | "refine-expand" | "refine-minimize" | "template";
  readonly score?: number;
  readonly issueCategories: readonly string[];
  readonly issueCount: number;
  readonly tokenSavings?: number;
  readonly timeSavedMs?: number;
  readonly optimizationOutcome?: LearningOptimizationOutcome;
  readonly templateTags: readonly string[];
}

export interface LearningSummary {
  readonly source?: string;
  readonly loaded: boolean;
  readonly signalCount: number;
  readonly acceptedOptimizationCount: number;
  readonly rejectedOptimizationCount: number;
  readonly issueCategories: Readonly<Record<string, number>>;
  readonly sourceCounts: Readonly<Record<string, number>>;
  readonly averageScore?: number;
  readonly averageTokenSavings?: number;
  readonly averageTimeSavedMs?: number;
  readonly totalTokenSavings: number;
  readonly totalTimeSavedMs: number;
}

const DEFAULT_LEARNING_FILE = "promptguard.learning.json";

export class PromptLearningService {
  private readonly cache = new Map<string, LearningSignal[]>();

  constructor(private readonly workspaceRoot?: string, private readonly fileName = DEFAULT_LEARNING_FILE) {}

  recordAnalyze(result: AnalysisResult): void {
    this.append({
      timestamp: result.analyzedAt,
      source: "analyze",
      score: result.score.total,
      issueCategories: result.issues.map(issue => issue.category),
      issueCount: result.issues.length,
      tokenSavings: result.optimization.estimatedTokenSavings ?? 0,
      timeSavedMs: 0,
      templateTags: []
    });
  }

  recordOptimization(source: LearningSignal["source"], issues: readonly PromptIssue[], tokenSavings = 0, timeSavedMs = 0, outcome: LearningOptimizationOutcome = "accepted"): void {
    this.append({
      timestamp: new Date().toISOString(),
      source,
      score: undefined,
      issueCategories: issues.map(issue => issue.category),
      issueCount: issues.length,
      tokenSavings,
      timeSavedMs,
      optimizationOutcome: outcome,
      templateTags: []
    });
  }

  recordTemplate(tags: readonly string[]): void {
    this.append({
      timestamp: new Date().toISOString(),
      source: "template",
      score: undefined,
      issueCategories: [],
      issueCount: 0,
      tokenSavings: 0,
      templateTags: tags
    });
  }

  summarize(): LearningSummary {
    const signals = this.load();
    if (!signals.length) {
      return { loaded: false, signalCount: 0, acceptedOptimizationCount: 0, rejectedOptimizationCount: 0, issueCategories: {}, sourceCounts: {}, totalTokenSavings: 0, totalTimeSavedMs: 0 };
    }

    const issueCategories: Record<string, number> = {};
    const sourceCounts: Record<string, number> = {};
    let scoreTotal = 0;
    let scoreCount = 0;
    let savingsTotal = 0;
    let savingsCount = 0;
    let timeSavedTotal = 0;
    let timeSavedCount = 0;
    let acceptedOptimizationCount = 0;
    let rejectedOptimizationCount = 0;

    for (const signal of signals) {
      sourceCounts[signal.source] = (sourceCounts[signal.source] ?? 0) + 1;
      for (const category of signal.issueCategories) {
        issueCategories[category] = (issueCategories[category] ?? 0) + 1;
      }
      if (signal.optimizationOutcome === "accepted") {
        acceptedOptimizationCount += 1;
      } else if (signal.optimizationOutcome === "rejected") {
        rejectedOptimizationCount += 1;
      }
      if (typeof signal.score === "number") {
        scoreTotal += signal.score;
        scoreCount += 1;
      }
      if (typeof signal.tokenSavings === "number") {
        savingsTotal += signal.tokenSavings;
        savingsCount += 1;
      }
      if (typeof signal.timeSavedMs === "number") {
        timeSavedTotal += signal.timeSavedMs;
        timeSavedCount += 1;
      }
    }

    return {
      source: this.learningPath(),
      loaded: true,
      signalCount: signals.length,
      acceptedOptimizationCount,
      rejectedOptimizationCount,
      issueCategories,
      sourceCounts,
      averageScore: scoreCount ? scoreTotal / scoreCount : undefined,
      averageTokenSavings: savingsCount ? savingsTotal / savingsCount : undefined,
      averageTimeSavedMs: timeSavedCount ? timeSavedTotal / timeSavedCount : undefined,
      totalTokenSavings: savingsTotal,
      totalTimeSavedMs: timeSavedTotal
    };
  }

  clearCache(): void {
    this.cache.clear();
  }

  private append(signal: LearningSignal): void {
    const current = this.load();
    const next = [signal, ...current].slice(0, 500);
    const file = this.learningPath();
    if (!file) {
      return;
    }
    this.write(file, next);
    this.cache.set(file, next);
  }

  private load(): LearningSignal[] {
    const file = this.learningPath();
    if (!file) {
      return [];
    }

    const cached = this.cache.get(file);
    if (cached) {
      return cached;
    }

    if (!fs.existsSync(file)) {
      return [];
    }

    try {
      const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
      const signals = this.parseSignals(parsed);
      this.cache.set(file, signals);
      return signals;
    } catch {
      return [];
    }
  }

  private parseSignals(value: unknown): LearningSignal[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value.filter((signal): signal is LearningSignal => {
      return typeof signal === "object" && signal !== null && typeof (signal as { timestamp?: unknown }).timestamp === "string" && typeof (signal as { source?: unknown }).source === "string";
    }).slice(0, 500);
  }

  private write(file: string, signals: LearningSignal[]): void {
    const dir = path.dirname(file);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(signals, undefined, 2), "utf8");
  }

  private learningPath(): string | undefined {
    if (!this.workspaceRoot) {
      return undefined;
    }
    return path.join(this.workspaceRoot, ".promptguard", this.fileName);
  }
}
