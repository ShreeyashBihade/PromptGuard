import { OptimizationSuggestion, PromptIssue } from "../types";
import { PromptOptimizationPipeline } from "./optimizationPipeline";

export class PromptOptimizer {
  private readonly pipeline = new PromptOptimizationPipeline();

  suggest(prompt: string, issues: PromptIssue[]): OptimizationSuggestion {
    return this.pipeline.run({ prompt, issues }).suggestion;
  }
}
