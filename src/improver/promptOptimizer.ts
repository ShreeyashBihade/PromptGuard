import { OptimizationSuggestion, PromptIssue } from "../types";
export class PromptOptimizer {
  suggest(prompt: string, issues: PromptIssue[]): OptimizationSuggestion {
    const additions: string[] = [];
    const ids = new Set(issues.map(issue => issue.ruleId));
    if (ids.has("missing-role")) additions.push("You are an expert assistant for this task.");
    if (ids.has("missing-constraints")) additions.push("Respect the stated scope; be concise and do not invent facts.");
    if (ids.has("missing-output-format")) additions.push("Return the result in clear Markdown with a short summary and actionable bullets.");
    const cleaned = prompt.replace(/\b(nice|good|better|appropriate|quickly|some|things)\b/gi, "specific").replace(/\s{2,}/g, " ").trim();
    const optimizedPrompt = additions.length ? `${additions.join("\n")}\n\nTask:\n${cleaned}` : cleaned;
    return { title: additions.length ? "Add structure and guardrails" : "Tighten wording", reason: "This preview preserves your intent while addressing the highest-impact lint findings.", optimizedPrompt, issuesAddressed: issues.slice(0, 5).map(issue => issue.ruleId) };
  }
}
