import { CostSimulatorProviderComparison, CostSimulatorReport, ProviderPricingProfile, PromptIssue } from "../../types";
import { PromptOptimizer } from "../../improver/promptOptimizer";
import { TokenProfilerService } from "../tokenProfiler";

export class PromptCostSimulatorService {
  private readonly profiler = new TokenProfilerService();
  private readonly optimizer = new PromptOptimizer();

  simulate(prompt: string, issues: readonly PromptIssue[] = [], providerPricing: readonly ProviderPricingProfile[] = [], monthlyRuns = 500): CostSimulatorReport {
    const profile = this.profiler.profile({ text: prompt });
    const optimized = this.optimizer.suggest(prompt, [...issues]);
    const optimizedProfile = this.profiler.profile({ text: optimized.optimizedPrompt });
    const yearlyRuns = monthlyRuns * 12;
    const providers = providerPricing.length ? [...providerPricing] : this.defaultProviders();
    const providerComparisons = providers.map(provider => this.comparisonForProvider(profile.totalTokens, optimizedProfile.totalTokens, monthlyRuns, provider));
    const optimizationSavingsTokens = Math.max(0, profile.totalTokens - optimizedProfile.totalTokens);
    const optimizationSavingsUsd = providerComparisons.length ? providerComparisons.reduce((sum, provider) => sum + provider.savingsAfterOptimizationMonthlyUsd, 0) / providerComparisons.length : 0;

    return {
      generatedAt: new Date().toISOString(),
      prompt,
      monthlyRuns,
      yearlyRuns,
      inputTokens: profile.totalTokens,
      outputTokens: this.estimateOutputTokens(profile.totalTokens),
      optimizedInputTokens: optimizedProfile.totalTokens,
      optimizedOutputTokens: this.estimateOutputTokens(optimizedProfile.totalTokens),
      optimizationSavingsTokens,
      optimizationSavingsUsd,
      providerComparisons
    };
  }

  private comparisonForProvider(inputTokens: number, optimizedInputTokens: number, monthlyRuns: number, provider: ProviderPricingProfile): CostSimulatorProviderComparison {
    const yearlyRuns = monthlyRuns * 12;
    const outputTokens = Math.max(64, Math.ceil(inputTokens * 0.5));
    const optimizedOutputTokens = Math.max(64, Math.ceil(optimizedInputTokens * 0.5));
    const inputCostUsdPerRun = this.costUsd(inputTokens, provider.inputPerMillionUsd);
    const outputCostUsdPerRun = this.costUsd(outputTokens, provider.outputPerMillionUsd);
    const optimizedInputCostUsdPerRun = this.costUsd(optimizedInputTokens, provider.inputPerMillionUsd);
    const optimizedOutputCostUsdPerRun = this.costUsd(optimizedOutputTokens, provider.outputPerMillionUsd);
    const monthlyInputCostUsd = inputCostUsdPerRun * monthlyRuns;
    const monthlyOutputCostUsd = outputCostUsdPerRun * monthlyRuns;
    const yearlyInputCostUsd = monthlyInputCostUsd * 12;
    const yearlyOutputCostUsd = monthlyOutputCostUsd * 12;
    const optimizedMonthlyInputCostUsd = optimizedInputCostUsdPerRun * monthlyRuns;
    const optimizedMonthlyOutputCostUsd = optimizedOutputCostUsdPerRun * monthlyRuns;
    const optimizedYearlyInputCostUsd = optimizedMonthlyInputCostUsd * 12;
    const optimizedYearlyOutputCostUsd = optimizedMonthlyOutputCostUsd * 12;

    return {
      provider: provider.provider,
      displayName: provider.displayName,
      inputCostUsdPerRun,
      outputCostUsdPerRun,
      totalCostUsdPerRun: inputCostUsdPerRun + outputCostUsdPerRun,
      latencyMs: provider.latencyMs,
      monthlyRuns,
      yearlyRuns,
      monthlyInputCostUsd,
      monthlyOutputCostUsd,
      yearlyInputCostUsd,
      yearlyOutputCostUsd,
      optimizedMonthlyInputCostUsd,
      optimizedMonthlyOutputCostUsd,
      optimizedYearlyInputCostUsd,
      optimizedYearlyOutputCostUsd,
      savingsAfterOptimizationMonthlyUsd: Math.max(0, monthlyInputCostUsd + monthlyOutputCostUsd - optimizedMonthlyInputCostUsd - optimizedMonthlyOutputCostUsd),
      savingsAfterOptimizationYearlyUsd: Math.max(0, yearlyInputCostUsd + yearlyOutputCostUsd - optimizedYearlyInputCostUsd - optimizedYearlyOutputCostUsd)
    };
  }

  private defaultProviders(): ProviderPricingProfile[] {
    const providers: ProviderPricingProfile[] = [
      { provider: "groq", displayName: "Groq", inputPerMillionUsd: 0.2, outputPerMillionUsd: 0.6, latencyMs: 180 },
      { provider: "openai", displayName: "OpenAI", inputPerMillionUsd: 2, outputPerMillionUsd: 8, latencyMs: 420 },
      { provider: "claude", displayName: "Claude", inputPerMillionUsd: 3, outputPerMillionUsd: 15, latencyMs: 600 },
      { provider: "gemini", displayName: "Gemini", inputPerMillionUsd: 1.25, outputPerMillionUsd: 5, latencyMs: 350 }
    ];

    return providers;
  }

  private costUsd(tokens: number, perMillionUsd: number): number {
    return tokens * perMillionUsd / 1_000_000;
  }

  private estimateOutputTokens(inputTokens: number): number {
    return Math.max(64, Math.ceil(inputTokens * 0.5));
  }
}