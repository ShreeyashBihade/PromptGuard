export type Severity = "info" | "warning" | "error";
export type Category = "context" | "specificity" | "constraints" | "examples" | "formatting" | "safety" | "efficiency" | "maintainability";

export interface TextRange {
  start: number;
  end: number;
}

export interface PromptIssue {
  id: string;
  ruleId: string;
  title: string;
  description: string;
  severity: Severity;
  confidence: number;
  category: Category;
  suggestedFix: string;
  range?: TextRange;
  estimatedTokenSavings: number;
  estimatedCostSavings: number;
}

export interface RuleContext {
  prompt: string;
  words: string[];
  sentences: string[];
}

export interface PromptRule {
  readonly id: string;
  readonly category: Category;
  analyze(context: RuleContext): PromptIssue[];
}

export interface ScoreBreakdown {
  context: number;
  specificity: number;
  constraints: number;
  examples: number;
  formatting: number;
  safety: number;
  efficiency: number;
  maintainability: number;
}

export interface PromptScore {
  total: number;
  breakdown: ScoreBreakdown;
  grade: string;
}

export interface ModelIdentity {
  vendor: string;
  id: string;
  family: string;
  name: string;
}

export interface PricingProfile {
  match: string;
  inputPerMillionUsd: number;
  outputPerMillionUsd: number;
}

export interface CostEstimate {
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd?: number;
  estimatedLatencyMs: number;
  wastedTokens: number;
  potentialSavingsUsd?: number;
  pricingSource: "configured" | "estimated" | "unavailable";
  model?: ModelIdentity;
}

export type ProviderId = "groq" | "openai" | "claude" | "gemini";

export interface ProviderPricingProfile {
  provider: ProviderId;
  displayName: string;
  inputPerMillionUsd: number;
  outputPerMillionUsd: number;
  latencyMs: number;
}

export interface CostSimulatorProviderComparison {
  provider: ProviderId;
  displayName: string;
  inputCostUsdPerRun: number;
  outputCostUsdPerRun: number;
  totalCostUsdPerRun: number;
  latencyMs: number;
  monthlyRuns: number;
  yearlyRuns: number;
  monthlyInputCostUsd: number;
  monthlyOutputCostUsd: number;
  yearlyInputCostUsd: number;
  yearlyOutputCostUsd: number;
  optimizedMonthlyInputCostUsd: number;
  optimizedMonthlyOutputCostUsd: number;
  optimizedYearlyInputCostUsd: number;
  optimizedYearlyOutputCostUsd: number;
  savingsAfterOptimizationMonthlyUsd: number;
  savingsAfterOptimizationYearlyUsd: number;
}

export interface CostSimulatorReport {
  generatedAt: string;
  prompt: string;
  monthlyRuns: number;
  yearlyRuns: number;
  inputTokens: number;
  outputTokens: number;
  optimizedInputTokens: number;
  optimizedOutputTokens: number;
  optimizationSavingsTokens: number;
  optimizationSavingsUsd: number;
  providerComparisons: readonly CostSimulatorProviderComparison[];
}

export interface PromptAnalyticsSample {
  label: string;
  timestamp: string;
  inputTokens: number;
  ambiguity: number;
  redundancy: number;
  quality: number;
  optimizationSavingsUsd: number;
  estimatedCostUsd: number;
}

export interface PromptAnalyticsReport {
  sampleCount: number;
  averageTokens: number;
  averageAmbiguity: number;
  averageRedundancy: number;
  averageQuality: number;
  averageOptimizationSavingsUsd: number;
  averageCostUsd: number;
  recentSamples: readonly PromptAnalyticsSample[];
}

export type OptimizationDiffChangeType = "added" | "removed" | "modified";

export interface OptimizationDiffChange {
  id: string;
  type: OptimizationDiffChangeType;
  lineNumber: number;
  originalText?: string;
  optimizedText?: string;
  tokenSavings: number;
  costSavingsUsd: number;
  accepted: boolean;
}

export interface OptimizationDiffView {
  totalTokenSavings: number;
  totalCostSavingsUsd: number;
  changes: readonly OptimizationDiffChange[];
  acceptedOptimizedPrompt: string;
}

export interface OptimizationSuggestion {
  title: string;
  reason: string;
  preview: string;
  optimizedPrompt: string;
  issuesAddressed: string[];
  estimatedTokenSavings?: number;
  confidence?: number;
  diff?: string;
  diffView?: OptimizationDiffView;
  compressionSteps?: ReadonlyArray<{ label: string; description: string; tokensSaved: number }>;
}

export interface ModelRecommendation {
  provider: "groq" | "openai" | "claude" | "gemini";
  model: string;
  fit: "high" | "medium";
  rationale: string;
}

export interface LocalInsights {
  bestPractices: string[];
  recommendations: ModelRecommendation[];
  mode: "local-only" | "cloud-assisted";
}

export interface AnalysisResult {
  prompt: string;
  issues: PromptIssue[];
  score: PromptScore;
  scoreSource: "local" | "groq";
  groqStatus?: string;
  cost: CostEstimate;
  optimization: OptimizationSuggestion;
  analyzedAt: string;
  localInsights?: LocalInsights;
}

export interface PromptHistoryEntry {
  id: string;
  timestamp: string;
  originalPrompt: string;
  optimizedPrompt: string;
  score: number;
  improvement: number;
  estimatedSavings: number;
}

export interface RulePlugin {
  name: string;
  rules: PromptRule[];
}

export interface PromptOptimizationLedgerEntry {
  id: string;
  timestamp: string;
  source: "editor" | "local-chat" | "chat-participant" | "on-save" | "refine-expand" | "refine-minimize" | "refine-cleanup";
  projectName: string;
  inputPrompt: string;
  outputPrompt: string;
  inputTokens: number;
  outputTokens: number;
  reducedTokens: number;
  reductionPercent: number;
  estimatedSavingsUsd: number;
  score?: number;
}

export interface PromptOptimizationLedgerTotals {
  projectName: string;
  totalEntries: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalReducedTokens: number;
  totalEstimatedSavingsUsd: number;
  averageReductionPercent: number;
}

export interface PromptOptimizationLedger {
  version: 1;
  updatedAt: string;
  totals: PromptOptimizationLedgerTotals;
  entries: PromptOptimizationLedgerEntry[];
}

export interface PromptGuardCoreVersion {
  readonly name: string;
  readonly version: string;
}
