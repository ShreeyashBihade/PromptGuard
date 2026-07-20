import { CostEstimator } from "../../cost/costEstimator";
import { PromptAstParser } from "../../analysis/promptAstParser";
import { PromptAstNode } from "../../analysis/promptAst";
import { AnalysisResult, PromptAnalyticsReport, PromptAnalyticsSample, PromptHistoryEntry } from "../../types";

const DEFAULT_INPUT_PER_MILLION_USD = 0.075;
const DEFAULT_OUTPUT_PER_MILLION_USD = 0.30;

export class PromptAnalyticsService {
  private readonly costEstimator = new CostEstimator();
  private readonly astParser = new PromptAstParser();

  build(history: readonly PromptHistoryEntry[], current?: AnalysisResult): PromptAnalyticsReport {
    const samples = history.map((entry, index) => this.sampleFromHistoryEntry(entry, index));
    if (!samples.length && current) {
      samples.push(this.sampleFromAnalysisResult(current));
    }

    const totals = samples.reduce((accumulator, sample) => {
      accumulator.inputTokens += sample.inputTokens;
      accumulator.ambiguity += sample.ambiguity;
      accumulator.redundancy += sample.redundancy;
      accumulator.quality += sample.quality;
      accumulator.optimizationSavingsUsd += sample.optimizationSavingsUsd;
      accumulator.estimatedCostUsd += sample.estimatedCostUsd;
      return accumulator;
    }, {
      inputTokens: 0,
      ambiguity: 0,
      redundancy: 0,
      quality: 0,
      optimizationSavingsUsd: 0,
      estimatedCostUsd: 0
    });

    const sampleCount = samples.length;
    return {
      sampleCount,
      averageTokens: sampleCount ? totals.inputTokens / sampleCount : 0,
      averageAmbiguity: sampleCount ? totals.ambiguity / sampleCount : 0,
      averageRedundancy: sampleCount ? totals.redundancy / sampleCount : 0,
      averageQuality: sampleCount ? totals.quality / sampleCount : 0,
      averageOptimizationSavingsUsd: sampleCount ? totals.optimizationSavingsUsd / sampleCount : 0,
      averageCostUsd: sampleCount ? totals.estimatedCostUsd / sampleCount : 0,
      recentSamples: [...samples].slice(0, 12).reverse()
    };
  }

  private sampleFromHistoryEntry(entry: PromptHistoryEntry, index: number): PromptAnalyticsSample {
    return this.sampleFromPrompt(entry.originalPrompt, entry.timestamp, `Prompt ${index + 1}`, entry.score, entry.estimatedSavings);
  }

  private sampleFromAnalysisResult(result: AnalysisResult): PromptAnalyticsSample {
    return this.sampleFromPrompt(result.prompt, result.analyzedAt, "Current prompt", result.score.total, result.cost.potentialSavingsUsd ?? 0);
  }

  private sampleFromPrompt(prompt: string, timestamp: string, label: string, quality: number, optimizationSavingsUsd: number): PromptAnalyticsSample {
    const estimate = this.costEstimator.estimate(prompt, []);
    const ast = this.astParser.parse(prompt);
    const metrics = this.blockMetrics(ast.children);
    const estimatedCostUsd = this.estimateCostUsd(estimate.inputTokens, estimate.outputTokens);

    return {
      label,
      timestamp,
      inputTokens: estimate.inputTokens,
      ambiguity: metrics.ambiguity,
      redundancy: metrics.redundancy,
      quality,
      optimizationSavingsUsd,
      estimatedCostUsd
    };
  }

  private blockMetrics(nodes: readonly PromptAstNode[]): { ambiguity: number; redundancy: number } {
    let weightedAmbiguity = 0;
    let weightedRedundancy = 0;
    let totalWeight = 0;

    const visit = (node: PromptAstNode): void => {
      const weight = Math.max(1, node.tokenCount);
      weightedAmbiguity += node.ambiguityScore * weight;
      weightedRedundancy += node.duplicateScore * weight;
      totalWeight += weight;
      node.children.forEach(child => visit(child));
    };

    nodes.forEach(node => visit(node));

    return {
      ambiguity: totalWeight ? weightedAmbiguity / totalWeight : 0,
      redundancy: totalWeight ? weightedRedundancy / totalWeight : 0
    };
  }

  private estimateCostUsd(inputTokens: number, outputTokens: number): number {
    return (inputTokens * DEFAULT_INPUT_PER_MILLION_USD + outputTokens * DEFAULT_OUTPUT_PER_MILLION_USD) / 1_000_000;
  }
}