import { Category, PromptIssue, PromptRule, RuleContext, Severity } from "../types";

export abstract class BaseRule implements PromptRule {
  public abstract readonly id: string;
  public abstract readonly category: Category;
  protected issue(title: string, description: string, severity: Severity, suggestedFix: string, savings = 0, start?: number, end?: number): PromptIssue {
    return { id: `${this.id}-${start ?? "global"}`, ruleId: this.id, title, description, severity, confidence: 0.86, category: this.category, suggestedFix, estimatedTokenSavings: savings, estimatedCostSavings: savings * 0.000003, range: start === undefined ? undefined : { start, end: end ?? start } };
  }
  public abstract analyze(context: RuleContext): PromptIssue[];
}
