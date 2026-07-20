import { builtinRules } from "../heuristics/rules";
import { AnalysisResult, PromptIssue, PromptRule, RuleContext } from "../types";
import { CostEstimator } from "../cost/costEstimator";
import { PromptOptimizer } from "../improver/promptOptimizer";
import { PromptScorer } from "../scoring/promptScorer";
import { PromptAstParser } from "./promptAstParser";

export class PromptAnalyzer {
  private readonly rules: PromptRule[];
  private readonly astParser = new PromptAstParser();
  constructor(rules: PromptRule[] = builtinRules.map(Rule => new Rule())) { this.rules = rules; }
  analyze(prompt: string, disabledRules: readonly string[] = []): AnalysisResult {
    const ast = this.astParser.parse(prompt);
    const context: RuleContext = this.astParser.toRuleContext(ast);
    const issues = this.rules.filter(rule => !disabledRules.includes(rule.id)).flatMap(rule => rule.analyze(context));
    return { prompt, issues, score: new PromptScorer().score(prompt, issues), scoreSource: "local", cost: new CostEstimator().estimate(prompt, issues), optimization: new PromptOptimizer().suggest(prompt, issues), analyzedAt: new Date().toISOString() };
  }
}
