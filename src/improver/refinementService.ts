import { PromptAnalyzer } from "../analysis/promptAnalyzer";
import { GroqGateway } from "../integrations/groq/groqGateway";

export type RefinementAction = "cleanup" | "expand" | "minimize";
export interface RefinementQuestion { id: string; question: string; options: string[]; }
export interface RefinementPlan { action: RefinementAction; questions: RefinementQuestion[]; costUsd: number; }
export interface RefinementResult { prompt: string; costUsd: number; sourceTokens: number; resultTokens: number; fellBack: boolean; }

export class RefinementService {
  private readonly plans = new Map<string, RefinementPlan>();
  constructor(private readonly groq = new GroqGateway(), private readonly analyzer = new PromptAnalyzer()) {}

  async plan(prompt: string, action: RefinementAction): Promise<RefinementPlan> {
    if (action !== "expand") return { action, questions: [], costUsd: 0 };
    const key = `${action}:${prompt}`; const cached = this.plans.get(key); if (cached) return cached;
    const instruction = "You are a prompt-clarification interviewer. Inspect the user's prompt and ask only questions whose answers would materially improve the final result. Return JSON only: {\"questions\":[{\"id\":\"snake_case_id\",\"question\":\"specific concise question\",\"options\":[\"choice\"]}]}. Ask zero to six questions as needed; do not use a generic questionnaire. Use 3-5 concise options per question, including 'Other (describe below)'. Never ask for details already present in the prompt. For a website request, ask about audience, core goal, essential pages/features, and visual direction only if missing.";
    const first = await this.groq.ask(instruction, prompt, 700); const questions = this.parseQuestions(first.content);
    if (questions) { const plan = { action, questions, costUsd: first.costUsd }; this.plans.set(key, plan); return plan; }
    const retry = await this.groq.ask(`${instruction} Return a valid JSON object only.`, prompt, 700);
    const plan = { action, questions: this.parseQuestions(retry.content) ?? [], costUsd: first.costUsd + retry.costUsd }; this.plans.set(key, plan); return plan;
  }

  async run(prompt: string, answers: Readonly<Record<string, string>>, action: RefinementAction): Promise<RefinementResult> {
    const sourceTokens = this.estimateTokens(prompt);
    if (action === "cleanup") { const cleaned = this.safeCleanup(prompt); return { prompt: cleaned, costUsd: 0, sourceTokens, resultTokens: this.estimateTokens(cleaned), fellBack: false }; }
    const answerContext = Object.entries(answers).filter(([, value]) => Boolean(value)).map(([key, value]) => `- ${key}: ${value}`).join("\n");
    const findings = action === "expand" ? this.analyzer.analyze(prompt).issues.filter(issue => issue.category !== "examples" && issue.ruleId !== "missing-role").map(issue => `${issue.title}: ${issue.suggestedFix}`) : [];
    const groqMode = action === "expand" ? "clarify" : "compress";
    const generated = await this.groq.improveWithContext(prompt, answerContext, findings, groqMode);
    if (action === "minimize" && (!this.preservesExplicitRequirements(prompt, generated.improvedPrompt) || generated.outputTokens >= sourceTokens)) {
      return { prompt, costUsd: generated.costUsd, sourceTokens, resultTokens: sourceTokens, fellBack: true };
    }
    const result = action === "expand" ? this.stripPresentationMarkup(generated.improvedPrompt) : generated.improvedPrompt;
    return { prompt: result, costUsd: generated.costUsd, sourceTokens, resultTokens: generated.outputTokens, fellBack: false };
  }

  private parseQuestions(source: string): RefinementQuestion[] | undefined {
    const start = source.indexOf("{"); const end = source.lastIndexOf("}"); if (start < 0 || end <= start) return undefined;
    try { const parsed = JSON.parse(source.slice(start, end + 1)) as { questions?: unknown }; if (!Array.isArray(parsed.questions)) return undefined; return parsed.questions.filter((item): item is RefinementQuestion => typeof item === "object" && item !== null && typeof (item as { id?: unknown }).id === "string" && typeof (item as { question?: unknown }).question === "string" && Array.isArray((item as { options?: unknown }).options) && (item as { options: unknown[] }).options.every(value => typeof value === "string")).slice(0, 6).map(question => ({ ...question, options: [...question.options.filter(option => !/^other/i.test(option)), "Other (describe below)"] })); } catch { return undefined; }
  }
  private safeCleanup(prompt: string): string {
    const seen = new Set<string>();
    return prompt.split(/\r?\n/).filter(line => { const key = line.trim().replace(/\s+/g, " ").toLowerCase(); if (!key || !seen.has(key)) { if (key) seen.add(key); return true; } return false; }).join("\n").replace(/\b(?:please|kindly)\s+/gi, "").replace(/\bI would like you to\s+/gi, "").replace(/\bI need you to\s+/gi, "").replace(/\bwe need to\s+/gi, "").replace(/\bnow,?\s+/gi, "").replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
  }
  private preservesExplicitRequirements(original: string, candidate: string): boolean {
    const output = candidate.toLowerCase(); const anchors = new Set<string>();
    for (const match of original.matchAll(/`([^`]{2,})`|["']([^"']{2,})["']|\b(?:[A-Z][A-Za-z0-9]+(?:[ -][A-Z][A-Za-z0-9]+)*)\b|\b\d+(?:\s*(?:hours?|days?|columns?))?\b/g)) { const value = (match[1] ?? match[2] ?? match[0]).trim().toLowerCase(); if (value.length >= 2) anchors.add(value); }
    return [...anchors].every(anchor => output.includes(anchor));
  }
  private estimateTokens(text: string): number { return Math.ceil(text.length / 4); }
  private stripPresentationMarkup(prompt: string): string { return prompt.replace(/^\s*#{1,6}\s+/gm, "").replace(/\*\*/g, "").replace(/^\s*[-*]\s+/gm, "").replace(/^\s*\d+[.)]\s+/gm, "").replace(/\n{3,}/g, "\n\n").trim(); }
}
