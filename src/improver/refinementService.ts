import { GroqGateway } from "../integrations/groq/groqGateway";
import { PromptAnalyzer } from "../analysis/promptAnalyzer";

export interface RefinementQuestion { id: string; question: string; options: string[]; }
export interface RefinementPlan { questions: RefinementQuestion[]; costUsd: number; }
const fallback: RefinementQuestion[] = [
  { id: "purpose", question: "What is the primary purpose?", options: ["Work / professional", "Personal / home", "School / learning", "Other"] },
  { id: "format", question: "How should the response be delivered?", options: ["Concise bullets", "Step-by-step guide", "Markdown report", "JSON / structured data"] },
  { id: "environment", question: "Which environment matters most?", options: ["Windows", "macOS", "Linux", "No specific environment"] }
];

export class RefinementService {
  constructor(private readonly groq = new GroqGateway(), private readonly analyzer = new PromptAnalyzer()) {}
  async plan(prompt: string): Promise<RefinementPlan> {
    const answer = await this.groq.ask("You design minimal prompt-refinement interviews. Return valid JSON only: {\"questions\":[{\"id\":\"short_id\",\"question\":\"one concise question\",\"options\":[\"option 1\",\"option 2\",\"option 3\",\"option 4\"]}]}. Ask at most 3 questions. Ask only information that materially changes the answer; include purpose, technical environment, or output format only when relevant.", prompt, 300);
    return { questions: this.parse(answer.content), costUsd: answer.costUsd };
  }
  async refine(prompt: string, answers: Readonly<Record<string, string>>): Promise<{ prompt: string; costUsd: number }> {
    const context = Object.entries(answers).map(([key, value]) => `- ${key}: ${value}`).join("\n");
    const findings = this.analyzer.analyze(prompt).issues.map(issue => `${issue.title}: ${issue.suggestedFix}`);
    const answer = await this.groq.improveWithContext(prompt, context, findings);
    const remaining = this.analyzer.analyze(answer.improvedPrompt).issues.map(issue => `${issue.title}: ${issue.suggestedFix}`);
    if (!remaining.length) return { prompt: answer.improvedPrompt, costUsd: answer.costUsd };
    const corrected = await this.groq.improveWithContext(answer.improvedPrompt, "Keep all existing user choices.", remaining);
    return { prompt: corrected.improvedPrompt, costUsd: answer.costUsd + corrected.costUsd };
  }
  private parse(source: string): RefinementQuestion[] {
    try { const parsed = JSON.parse(source.replace(/^```json\s*|\s*```$/g, "")) as { questions?: unknown }; const questions = Array.isArray(parsed.questions) ? parsed.questions : []; const valid = questions.filter((item): item is { id: string; question: string; options: string[] } => typeof item === "object" && item !== null && typeof (item as { id?: unknown }).id === "string" && typeof (item as { question?: unknown }).question === "string" && Array.isArray((item as { options?: unknown }).options) && (item as { options: unknown[] }).options.every(option => typeof option === "string")).slice(0, 3); return (valid.length ? valid : fallback).map(question => ({ ...question, options: [...question.options.filter(option => !/^other/i.test(option)), "Other (describe below)"] })); } catch { return fallback.map(question => ({ ...question, options: [...question.options, "Other (describe below)"] })); }
  }
}
