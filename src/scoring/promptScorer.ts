import { Category, PromptIssue, PromptScore, ScoreBreakdown } from "../types";
const categories: Category[] = ["context", "specificity", "constraints", "examples", "formatting", "safety", "efficiency", "maintainability"];
export class PromptScorer {
  score(prompt: string, issues: PromptIssue[]): PromptScore {
    const values = {} as ScoreBreakdown;
    for (const category of categories) {
      const penalty = issues.filter(issue => issue.category === category).reduce((total, issue) => total + (issue.severity === "error" ? 35 : issue.severity === "warning" ? 18 : 8), 0);
      values[category] = Math.max(0, 100 - penalty);
    }
    if (prompt.trim().length < 20) values.context = Math.min(values.context, 35);
    const total = Math.round(categories.reduce((sum, category) => sum + values[category], 0) / categories.length);
    return { total, breakdown: values, grade: total >= 85 ? "Excellent" : total >= 70 ? "Strong" : total >= 50 ? "Needs work" : "At risk" };
  }
}
