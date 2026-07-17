import { CostEstimate, ModelIdentity, PricingProfile, PromptIssue } from "../types";
export class CostEstimator {
  estimate(prompt: string, issues: PromptIssue[], options: { inputTokens?: number; model?: ModelIdentity; pricing?: PricingProfile[] } = {}): CostEstimate {
    const inputTokens = options.inputTokens ?? Math.ceil(prompt.length / 4);
    const outputTokens = Math.max(150, Math.ceil(inputTokens * 0.75));
    const wastedTokens = issues.reduce((total, issue) => total + issue.estimatedTokenSavings, 0);
    const key = `${options.model?.vendor ?? ""} ${options.model?.id ?? ""} ${options.model?.family ?? ""}`.toLowerCase();
    const profile = options.pricing?.find(candidate => key.includes(candidate.match.toLowerCase()));
    const estimatedCostUsd = profile ? inputTokens * profile.inputPerMillionUsd / 1_000_000 + outputTokens * profile.outputPerMillionUsd / 1_000_000 : undefined;
    return { inputTokens, outputTokens, estimatedCostUsd, estimatedLatencyMs: 300 + Math.round((inputTokens + outputTokens) * 1.7), wastedTokens, potentialSavingsUsd: profile ? wastedTokens * profile.inputPerMillionUsd / 1_000_000 : undefined, pricingSource: profile ? "configured" : options.model ? "unavailable" : "estimated", model: options.model };
  }
}
