import * as fs from "fs";
import * as path from "path";
import { LiveTokenPricing } from "../../config/settings";
import { TokenProfilerService, TokenProfileReport } from "../tokenProfiler";

export interface PromptBudgetFile {
  readonly version: 1;
  readonly name?: string;
  readonly maxTokens?: number;
  readonly maxInputCostUsd?: number;
  readonly maxOutputCostUsd?: number;
  readonly maxLatencyMs?: number;
}

export interface PromptBudgetViolation {
  readonly field: "maxTokens" | "maxInputCostUsd" | "maxOutputCostUsd" | "maxLatencyMs";
  readonly message: string;
  readonly suggestedFix: string;
  readonly recommendedCommand: "promptguard.optimize";
}

export interface PromptBudgetReport {
  readonly source?: string;
  readonly loaded: boolean;
  readonly profile: TokenProfileReport;
  readonly violationCount: number;
  readonly violations: readonly PromptBudgetViolation[];
}

export class PromptBudgetService {
  private readonly cache = new Map<string, PromptBudgetFile>();

  constructor(private readonly workspaceRoot?: string, private readonly profiler = new TokenProfilerService()) {}

  load(): PromptBudgetFile | undefined {
    const budgetPath = this.budgetPath();
    if (!budgetPath) return undefined;
    const cached = this.cache.get(budgetPath);
    if (cached) return cached;
    if (!fs.existsSync(budgetPath)) return undefined;
    const parsed = this.parse(fs.readFileSync(budgetPath, "utf8"));
    if (!parsed) return undefined;
    this.cache.set(budgetPath, parsed);
    return parsed;
  }

  validate(prompt: string, pricing?: LiveTokenPricing): PromptBudgetReport {
    const profile = this.profiler.profile({ text: prompt, pricing });
    const budget = this.load();
    if (!budget) return { loaded: false, profile, violationCount: 0, violations: [] };
    const violations = this.check(profile, budget);
    return { source: this.budgetPath(), loaded: true, profile, violationCount: violations.length, violations };
  }

  clearCache(): void {
    this.cache.clear();
  }

  private check(profile: TokenProfileReport, budget: PromptBudgetFile): PromptBudgetViolation[] {
    const violations: PromptBudgetViolation[] = [];
    if (typeof budget.maxTokens === "number" && profile.totalTokens > budget.maxTokens) violations.push({ field: "maxTokens", message: `Prompt uses ${profile.totalTokens} tokens, above the ${budget.maxTokens} token budget.`, suggestedFix: "Open the optimization diff view and remove low-value context or repeated wording.", recommendedCommand: "promptguard.optimize" });
    if (typeof budget.maxInputCostUsd === "number" && profile.estimatedInputCostUsd > budget.maxInputCostUsd) violations.push({ field: "maxInputCostUsd", message: `Estimated input cost ${this.money(profile.estimatedInputCostUsd)} exceeds budget ${this.money(budget.maxInputCostUsd)}.`, suggestedFix: "Trim the prompt or move repetitive background into a reusable template.", recommendedCommand: "promptguard.optimize" });
    if (typeof budget.maxOutputCostUsd === "number" && profile.estimatedOutputCostUsd > budget.maxOutputCostUsd) violations.push({ field: "maxOutputCostUsd", message: `Estimated output cost ${this.money(profile.estimatedOutputCostUsd)} exceeds budget ${this.money(budget.maxOutputCostUsd)}.`, suggestedFix: "Tighten the output format and ask for a shorter response.", recommendedCommand: "promptguard.optimize" });
    if (typeof budget.maxLatencyMs === "number" && profile.latencyMs > budget.maxLatencyMs) violations.push({ field: "maxLatencyMs", message: `Estimated latency ${profile.latencyMs}ms exceeds budget ${budget.maxLatencyMs}ms.`, suggestedFix: "Shorten the prompt and use a more specific task statement to reduce processing time.", recommendedCommand: "promptguard.optimize" });
    return violations;
  }

  private budgetPath(): string | undefined {
    if (!this.workspaceRoot) return undefined;
    return path.join(this.workspaceRoot, "promptguard.budget.json");
  }

  private parse(source: string): PromptBudgetFile | undefined {
    try {
      const value = JSON.parse(source) as Partial<PromptBudgetFile>;
      if (value.version !== 1) return undefined;
      return { version: 1, name: typeof value.name === "string" ? value.name : undefined, maxTokens: typeof value.maxTokens === "number" ? value.maxTokens : undefined, maxInputCostUsd: typeof value.maxInputCostUsd === "number" ? value.maxInputCostUsd : undefined, maxOutputCostUsd: typeof value.maxOutputCostUsd === "number" ? value.maxOutputCostUsd : undefined, maxLatencyMs: typeof value.maxLatencyMs === "number" ? value.maxLatencyMs : undefined };
    } catch {
      return undefined;
    }
  }

  private money(value: number): string {
    return `$${value.toFixed(6)}`;
  }
}
