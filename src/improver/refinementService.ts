import { PromptAnalyzer } from "../analysis/promptAnalyzer";
import { GroqGateway } from "../integrations/groq/groqGateway";

export type RefinementMode = "clarify" | "cleanup";
export interface RefinementQuestion { id: string; question: string; options: string[]; }
export interface RefinementPlan { mode: RefinementMode; questions: RefinementQuestion[]; costUsd: number; }

const shortFallback: RefinementQuestion[] = [
  { id: "goal", question: "What should the result help you accomplish?", options: ["Make a decision", "Create an artifact", "Learn a topic", "Solve a technical task", "Other (describe below)"] },
  { id: "output", question: "What response shape would be most useful?", options: ["Concise answer", "Step-by-step guide", "Markdown document", "Structured JSON", "Other (describe below)"] }
];

export class RefinementService {
  private readonly plans = new Map<string, RefinementPlan>();
  constructor(private readonly groq = new GroqGateway(), private readonly analyzer = new PromptAnalyzer()) {}
  modeFor(prompt: string): RefinementMode { return prompt.trim().split(/\s+/).length <= 60 || prompt.length <= 360 ? "clarify" : "cleanup"; }
  async plan(prompt: string): Promise<RefinementPlan> {
    const cached = this.plans.get(prompt); if (cached) return cached;
    const mode = this.modeFor(prompt);
    if (mode === "cleanup") return { mode, questions: [], costUsd: 0 };
    const instruction = "You are a prompt-refinement interviewer. Return JSON only, with no Markdown: {\"questions\":[{\"id\":\"goal\",\"question\":\"...\",\"options\":[\"...\"]}]}. Ask one or two questions only. Questions must be specifically motivated by the supplied prompt; never ask a generic repeated questionnaire. Each question has 3-5 concise choices and an 'Other (describe below)' choice. Do not ask for information already present. Focus on the missing detail that most changes the outcome.";
    const answer = await this.groq.ask(instruction, prompt, 420);
    const first = this.parse(answer.content);
    if (first) { const plan = { mode, questions: first, costUsd: answer.costUsd }; this.plans.set(prompt, plan); return plan; }
    const retry = await this.groq.ask(`${instruction} Your prior response was malformed. Return the JSON object now; no explanation.`, prompt, 520);
    const plan = { mode, questions: this.parse(retry.content) ?? shortFallback, costUsd: answer.costUsd + retry.costUsd };
    this.plans.set(prompt, plan); return plan;
  }
  async refine(prompt: string, answers: Readonly<Record<string, string>>, strategy: "cleanup" | "rewrite" = "cleanup"): Promise<{ prompt: string; costUsd: number }> {
    const mode = this.modeFor(prompt); if (mode === "cleanup" && strategy === "cleanup") return { prompt: this.safeCompress(prompt), costUsd: 0 };
    const findings = this.analyzer.analyze(prompt).issues.map(issue => `${issue.title}: ${issue.suggestedFix}`);
    const context = Object.entries(answers).filter(([, value]) => Boolean(value)).map(([key, value]) => `- ${key}: ${value}`).join("\n");
    const groqMode = mode === "clarify" ? "clarify" : "compress";
    const answer = await this.groq.improveWithContext(prompt, context, groqMode === "clarify" ? [] : findings, groqMode);
    if (groqMode === "compress" && (!this.preservesExplicitRequirements(prompt, answer.improvedPrompt) || !this.preservesDepth(prompt, answer.improvedPrompt) || answer.outputTokens > this.estimateTokens(prompt))) return { prompt: this.safeCompress(prompt), costUsd: answer.costUsd };
    return { prompt: groqMode === "clarify" ? this.compactGeneratedPrompt(answer.improvedPrompt) : answer.improvedPrompt, costUsd: answer.costUsd };
  }
  private parse(source: string): RefinementQuestion[] | undefined {
    const json = this.extractJson(source); if (!json) return undefined;
    try { const parsed = JSON.parse(json) as { questions?: unknown }; const questions = Array.isArray(parsed.questions) ? parsed.questions : []; const valid = questions.filter((item): item is RefinementQuestion => typeof item === "object" && item !== null && typeof (item as { id?: unknown }).id === "string" && typeof (item as { question?: unknown }).question === "string" && Array.isArray((item as { options?: unknown }).options) && (item as { options: unknown[] }).options.every(option => typeof option === "string")).slice(0, 2); return valid.length ? valid.map(question => ({ ...question, options: [...question.options.filter(option => !/^other/i.test(option)), "Other (describe below)"] })) : undefined; } catch { return undefined; }
  }
  private extractJson(source: string): string | undefined { const start = source.indexOf("{"); const end = source.lastIndexOf("}"); return start >= 0 && end > start ? source.slice(start, end + 1) : undefined; }
  private preservesExplicitRequirements(original: string, candidate: string): boolean {
    const normalized = candidate.toLowerCase();
    const anchors = new Set<string>();
    for (const match of original.matchAll(/`([^`]{2,})`|["']([^"']{2,})["']|\b(?:[A-Z][A-Za-z0-9]+(?:[ -][A-Z][A-Za-z0-9]+)*)\b|\b\d+(?:\s*(?:hours?|days?|columns?))?\b/g)) {
      const value = (match[1] ?? match[2] ?? match[0]).trim().toLowerCase(); if (value.length >= 2) anchors.add(value);
    }
    for (const sentence of original.split(/(?<=[.!?])\s+/)) {
      if (/\b(must|need|require|whenever|every|only|case|column|store|collect|authenticate|authorize)\b/i.test(sentence)) {
        for (const word of sentence.match(/\b[A-Za-z][A-Za-z0-9_-]{5,}\b/g) ?? []) anchors.add(word.toLowerCase());
      }
    }
    return [...anchors].every(anchor => normalized.includes(anchor));
  }
  private safeCompress(prompt: string): string {
    const seen = new Set<string>();
    const lines = prompt.split(/\r?\n/).filter(line => {
      const key = line.trim().replace(/\s+/g, " ").toLowerCase();
      if (!key || !seen.has(key)) { if (key) seen.add(key); return true; }
      return false;
    });
    return lines.join("\n").replace(/\b(?:please|kindly)\s+/gi, "").replace(/\bI would like you to\s+/gi, "").replace(/\bI need you to\s+/gi, "").replace(/\bwe need to\s+/gi, "").replace(/\bnow,?\s+/gi, "").replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
  }
  private preservesDepth(original: string, candidate: string): boolean {
    const originalWords = original.trim().split(/\s+/).filter(Boolean).length;
    const candidateWords = candidate.trim().split(/\s+/).filter(Boolean).length;
    return candidateWords >= Math.ceil(originalWords * 0.92);
  }
  private estimateTokens(text: string): number { return Math.ceil(text.length / 4); }
  private compactGeneratedPrompt(prompt: string): string {
    return prompt.replace(/^\s*#{1,6}\s+/gm, "").replace(/\*\*/g, "").replace(/^\s*[-*]\s+/gm, "").replace(/^\s*\d+[.)]\s+/gm, "").replace(/```[\s\S]*?```/g, match => match.replace(/```/g, "")).replace(/\n{3,}/g, "\n\n").trim();
  }
}
