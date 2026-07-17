export type Severity = "info" | "warning" | "error";
export type Category = "context" | "specificity" | "constraints" | "examples" | "formatting" | "safety" | "efficiency" | "maintainability";

export interface TextRange { start: number; end: number; }
export interface PromptIssue {
  id: string; ruleId: string; title: string; description: string; severity: Severity; confidence: number;
  category: Category; suggestedFix: string; range?: TextRange; estimatedTokenSavings: number; estimatedCostSavings: number;
}
export interface RuleContext { prompt: string; words: string[]; sentences: string[]; }
export interface PromptRule { readonly id: string; readonly category: Category; analyze(context: RuleContext): PromptIssue[]; }
export interface ScoreBreakdown { context: number; specificity: number; constraints: number; examples: number; formatting: number; safety: number; efficiency: number; maintainability: number; }
export interface PromptScore { total: number; breakdown: ScoreBreakdown; grade: string; }
export interface ModelIdentity { vendor: string; id: string; family: string; name: string; }
export interface PricingProfile { match: string; inputPerMillionUsd: number; outputPerMillionUsd: number; }
export interface CostEstimate { inputTokens: number; outputTokens: number; estimatedCostUsd?: number; estimatedLatencyMs: number; wastedTokens: number; potentialSavingsUsd?: number; pricingSource: "configured" | "estimated" | "unavailable"; model?: ModelIdentity; }
export interface OptimizationSuggestion { title: string; reason: string; optimizedPrompt: string; issuesAddressed: string[]; }
export interface AnalysisResult { prompt: string; issues: PromptIssue[]; score: PromptScore; scoreSource: "local" | "groq"; groqStatus?: string; cost: CostEstimate; optimization: OptimizationSuggestion; analyzedAt: string; }
export interface PromptHistoryEntry { id: string; timestamp: string; originalPrompt: string; optimizedPrompt: string; score: number; improvement: number; estimatedSavings: number; }
export interface RulePlugin { name: string; rules: PromptRule[]; }
