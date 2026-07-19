import { Category, PromptIssue, PromptScore, ScoreBreakdown } from "../types";
const categories: Category[] = ["context", "specificity", "constraints", "examples", "formatting", "safety", "efficiency", "maintainability"];
export class PromptScorer {
  score(prompt: string, issues: PromptIssue[]): PromptScore {
    if (/\b(?:website|webpage|site)\b/i.test(prompt)) return this.scoreWebsitePrompt(prompt, issues);
    const values = {} as ScoreBreakdown;
    for (const category of categories) {
      const penalty = issues.filter(issue => issue.category === category).reduce((total, issue) => total + (issue.severity === "error" ? 35 : issue.severity === "warning" ? 18 : 8), 0);
      values[category] = Math.max(0, 100 - penalty);
    }
    if (prompt.trim().length < 20) values.context = Math.min(values.context, 35);
    const total = Math.round(categories.reduce((sum, category) => sum + values[category], 0) / categories.length);
    return { total, breakdown: values, grade: total >= 85 ? "Excellent" : total >= 70 ? "Strong" : total >= 50 ? "Needs work" : "At risk" };
  }
  private scoreWebsitePrompt(prompt: string, issues: PromptIssue[]): PromptScore {
    const lower = prompt.toLowerCase();
    const hasAudience = /\b(parent|guardian|customer|visitor|student|child|family|user)\b/.test(lower);
    const hasVisualDirection = /\b(modern|minimal|pastel|color|design|brand|warm|playful|professional)\b/.test(lower);
    const hasConcreteScope = /\b(home|about|program|admission|enroll|contact|gallery|form|booking|section|page)\b/.test(lower);
    const hasConversion = /\b(enroll|contact|book|apply|call to action|cta)\b/.test(lower);
    const hasQualityConstraint = /\b(responsive|mobile|accessible|accessibility|wcag|fast|performance)\b/.test(lower);
    const penalty = (category: Category): number => issues.filter(issue => issue.category === category && !["missing-role", "missing-output-format", "missing-examples", "missing-constraints"].includes(issue.ruleId)).reduce((sum, issue) => sum + (issue.severity === "error" ? 30 : issue.severity === "warning" ? 12 : 5), 0);
    const values: ScoreBreakdown = {
      context: Math.max(0, 35 + (hasAudience ? 22 : 0) + (hasConversion ? 10 : 0) - penalty("context")),
      specificity: Math.max(0, 30 + (hasVisualDirection ? 20 : 0) + (hasConcreteScope ? 25 : 0) - penalty("specificity")),
      constraints: Math.max(0, 45 + (hasQualityConstraint ? 18 : 0) - penalty("constraints")),
      examples: 80,
      formatting: 80,
      safety: Math.max(0, 100 - penalty("safety")),
      efficiency: Math.max(0, 90 - penalty("efficiency")),
      maintainability: 55
    };
    const total = Math.round(categories.reduce((sum, category) => sum + values[category], 0) / categories.length);
    return { total, breakdown: values, grade: total >= 85 ? "Excellent" : total >= 70 ? "Strong" : total >= 50 ? "Needs work" : "At risk" };
  }
}
