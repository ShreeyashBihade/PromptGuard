import { PromptAnalyzer } from "../analysis/promptAnalyzer";
import { GroqGateway } from "../integrations/groq/groqGateway";
import { PromptCompressionEngine } from "./promptCompressionEngine";

export type RefinementAction = "cleanup" | "expand" | "minimize";
export interface RefinementQuestion { id: string; question: string; options: string[]; }
export interface RefinementPlan { action: RefinementAction; questions: RefinementQuestion[]; costUsd: number; }
export interface RefinementResult { prompt: string; costUsd: number; sourceTokens: number; resultTokens: number; fellBack: boolean; note?: string; }

export class RefinementService {
  private readonly plans = new Map<string, RefinementPlan>();
  private readonly compressionEngine = new PromptCompressionEngine();
  private static readonly MIN_WIN_TOKENS = 4;
  private static readonly MIN_CAVEMAN_SOURCE_TOKENS = 24;
  private static readonly WEIGHTED_DICTIONARY: ReadonlyArray<{ phrase: string; shortform: string; weight: number }> = [
    { phrase: "Machine Learning", shortform: "ML", weight: 10 },
    { phrase: "Artificial Intelligence", shortform: "AI", weight: 10 },
    { phrase: "Large Language Model", shortform: "LLM", weight: 10 },
    { phrase: "Natural Language Processing", shortform: "NLP", weight: 10 },
    { phrase: "Retrieval Augmented Generation", shortform: "RAG", weight: 10 },
    { phrase: "User Interface", shortform: "UI", weight: 9 },
    { phrase: "User Experience", shortform: "UX", weight: 9 },
    { phrase: "Application Programming Interface", shortform: "API", weight: 9 },
    { phrase: "Customer Relationship Management", shortform: "CRM", weight: 9 },
    { phrase: "Quality Assurance", shortform: "QA", weight: 9 },
    { phrase: "Continuous Integration", shortform: "CI", weight: 9 },
    { phrase: "Continuous Deployment", shortform: "CD", weight: 9 },
    { phrase: "Command Line Interface", shortform: "CLI", weight: 9 },
    { phrase: "Hyper Text Markup Language", shortform: "HTML", weight: 9 },
    { phrase: "Cascading Style Sheets", shortform: "CSS", weight: 9 },
    { phrase: "JavaScript Object Notation", shortform: "JSON", weight: 9 },
    { phrase: "Representational State Transfer", shortform: "REST", weight: 9 },
    { phrase: "Structured Query Language", shortform: "SQL", weight: 9 },
    { phrase: "Not Applicable", shortform: "N/A", weight: 8 },
    { phrase: "For Example", shortform: "e.g.", weight: 8 },
    { phrase: "That Is", shortform: "i.e.", weight: 8 },
    { phrase: "As Soon As Possible", shortform: "ASAP", weight: 8 },
    { phrase: "In Order To", shortform: "to", weight: 8 },
    { phrase: "Due To The Fact That", shortform: "because", weight: 8 },
    { phrase: "At This Point In Time", shortform: "now", weight: 8 },
    { phrase: "Prior To", shortform: "before", weight: 7 },
    { phrase: "In The Event That", shortform: "if", weight: 7 },
    { phrase: "With Respect To", shortform: "regarding", weight: 7 },
    { phrase: "In The Context Of", shortform: "for", weight: 7 },
    { phrase: "The Purpose Of", shortform: "purpose", weight: 7 },
    { phrase: "Success Criteria", shortform: "success criteria", weight: 7 },
    { phrase: "Acceptance Criteria", shortform: "acceptance criteria", weight: 7 },
    { phrase: "Performance Optimization", shortform: "perf opt", weight: 7 },
    { phrase: "Production Ready", shortform: "prod-ready", weight: 7 },
    { phrase: "High Availability", shortform: "HA", weight: 7 },
    { phrase: "Disaster Recovery", shortform: "DR", weight: 7 },
    { phrase: "Project Management", shortform: "PM", weight: 6 },
    { phrase: "Security Requirements", shortform: "security reqs", weight: 6 },
    { phrase: "Implementation Details", shortform: "implementation details", weight: 6 },
    { phrase: "Configuration", shortform: "config", weight: 6 },
    { phrase: "Documentation", shortform: "docs", weight: 6 },
    { phrase: "Environment", shortform: "env", weight: 6 },
    { phrase: "Requirements", shortform: "reqs", weight: 6 },
    { phrase: "Internationalization", shortform: "i18n", weight: 6 },
    { phrase: "Authentication", shortform: "auth", weight: 6 },
    { phrase: "Authorization", shortform: "authz", weight: 6 },
    { phrase: "Database", shortform: "DB", weight: 6 },
    { phrase: "Development", shortform: "dev", weight: 5 },
    { phrase: "Operations", shortform: "ops", weight: 5 },
    { phrase: "Metrics", shortform: "metrics", weight: 5 },
    { phrase: "Observability", shortform: "obs", weight: 5 },
    { phrase: "Monitoring", shortform: "monitoring", weight: 5 },
    { phrase: "Optimization", shortform: "opt", weight: 5 },
    { phrase: "Background", shortform: "bg", weight: 5 },
    { phrase: "Frontend", shortform: "frontend", weight: 5 },
    { phrase: "Backend", shortform: "backend", weight: 5 },
    { phrase: "Workflow", shortform: "workflow", weight: 5 }
  ];
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
    if (action === "minimize") {
      if (sourceTokens < RefinementService.MIN_CAVEMAN_SOURCE_TOKENS || prompt.trim().length < 160) {
        return { prompt, costUsd: 0, sourceTokens, resultTokens: sourceTokens, fellBack: true, note: "Prompt is too short for safe caveman compression." };
      }
      const minimized = this.localMinimize(prompt);
      const minimizedTokens = this.estimateTokens(minimized);
      if (!minimized || !this.preservesExplicitRequirements(prompt, minimized) || minimizedTokens >= sourceTokens || minimized.length >= prompt.length) {
        return { prompt, costUsd: 0, sourceTokens, resultTokens: sourceTokens, fellBack: true };
      }
      return { prompt: minimized, costUsd: 0, sourceTokens, resultTokens: minimizedTokens, fellBack: false };
    }
    const answerContext = Object.entries(answers).filter(([, value]) => Boolean(value)).map(([key, value]) => `- ${key}: ${value}`).join("\n");
    const findings = this.analyzer.analyze(prompt).issues.filter(issue => issue.category !== "examples" && issue.ruleId !== "missing-role").map(issue => `${issue.title}: ${issue.suggestedFix}`);
    const generated = await this.groq.improveWithContext(prompt, answerContext, findings, "clarify");
    const result = this.stripPresentationMarkup(generated.improvedPrompt);
    if (this.looksLikeCompletedArtifact(prompt, result)) {
      return {
        prompt,
        costUsd: generated.costUsd,
        sourceTokens,
        resultTokens: sourceTokens,
        fellBack: true,
        note: "Groq returned a completed artifact instead of a rewritten prompt. PromptGuard kept your original prompt."
      };
    }
    return { prompt: result, costUsd: generated.costUsd, sourceTokens, resultTokens: this.estimateTokens(result), fellBack: false };
  }

  private parseQuestions(source: string): RefinementQuestion[] | undefined {
    const start = source.indexOf("{"); const end = source.lastIndexOf("}"); if (start < 0 || end <= start) return undefined;
    try { const parsed = JSON.parse(source.slice(start, end + 1)) as { questions?: unknown }; if (!Array.isArray(parsed.questions)) return undefined; return parsed.questions.filter((item): item is RefinementQuestion => typeof item === "object" && item !== null && typeof (item as { id?: unknown }).id === "string" && typeof (item as { question?: unknown }).question === "string" && Array.isArray((item as { options?: unknown }).options) && (item as { options: unknown[] }).options.every(value => typeof value === "string")).slice(0, 6).map(question => ({ ...question, options: [...question.options.filter(option => !/^other/i.test(option)), "Other (describe below)"] })); } catch { return undefined; }
  }
  private safeCleanup(prompt: string): string {
    const seen = new Set<string>();
    return prompt.split(/\r?\n/).filter(line => { const key = line.trim().replace(/\s+/g, " ").toLowerCase(); if (!key || !seen.has(key)) { if (key) seen.add(key); return true; } return false; }).join("\n").replace(/\b(?:please|kindly)\s+/gi, "").replace(/\bI would like you to\s+/gi, "").replace(/\bI need you to\s+/gi, "").replace(/\bwe need to\s+/gi, "").replace(/\bnow,?\s+/gi, "").replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
  }
  private localMinimize(prompt: string): string {
    const candidates = [this.cavemanMinimize(prompt), this.compressionEngine.compress(prompt).optimizedPrompt]
      .map(candidate => this.stripPresentationMarkup(candidate).trim())
      .filter(Boolean)
      .filter(candidate => this.isValidMinimizeCandidate(prompt, candidate));
    if (!candidates.length) return prompt;
    return candidates.sort((left, right) => this.estimateTokens(left) - this.estimateTokens(right))[0] ?? prompt;
  }
  private cavemanMinimize(prompt: string): string {
    const compactedLines = prompt
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean)
      .filter((line, index, all) => all.findIndex(candidate => candidate.toLowerCase() === line.toLowerCase()) === index);

    return this.applyWeightedDictionary(compactedLines.join("\n"))
      .replace(/\b(?:please|kindly|just|simply|really|basically|actually)\s+/gi, "")
      .replace(/\b(?:i would like you to|i need you to|we need to|can you)\s+/gi, "")
      .replace(/\b(?:in order to|as soon as possible|at this point in time)\b/gi, "")
      .replace(/\b([A-Za-z]{3,})\s+\1\b/gi, "$1")
      .replace(/[ \t]+/g, " ")
      .replace(/\s+([,.;:!?])/g, "$1")
      .replace(/([,.;:!?])(\S)/g, "$1 $2")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }
  private isValidMinimizeCandidate(original: string, candidate: string): boolean {
    const before = this.estimateTokens(original);
    const after = this.estimateTokens(candidate);
    const win = before - after;
    if (candidate.length >= original.length || after >= before || win < RefinementService.MIN_WIN_TOKENS) return false;
    if (!this.preservesExplicitRequirements(original, candidate)) return false;
    if (this.looksLikeCompletedArtifact(original, candidate)) return false;
    return true;
  }
  private applyWeightedDictionary(prompt: string): string {
    const ordered = [...RefinementService.WEIGHTED_DICTIONARY].sort((left, right) => right.weight - left.weight || right.phrase.length - left.phrase.length);
    return ordered.reduce((current, entry) => {
      const pattern = new RegExp(`\\b${this.escapeRegExp(entry.phrase)}\\b`, "gi");
      return current.replace(pattern, entry.shortform);
    }, prompt);
  }
  private escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  private looksLikeCompletedArtifact(originalPrompt: string, candidate: string): boolean {
    const original = originalPrompt.toLowerCase();
    const output = candidate.toLowerCase();

    const asksForCreation = /(write|create|generate|draft|prepare|build|produce)\b/.test(original);
    const hasPromptCue = /(task:|objective:|you are|act as|return|must|constraints?|requirements?|output format|before answering)/.test(output);
    const hasArtifactSignals = /(\*\*devlog|^devlog\b|release notes|summary:|completed|implemented|fixed|shipped|today we|in this session)/m.test(output);

    return asksForCreation && hasArtifactSignals && !hasPromptCue;
  }
  private preservesExplicitRequirements(original: string, candidate: string): boolean {
    const output = candidate.toLowerCase(); const anchors = new Set<string>();
    for (const match of original.matchAll(/`([^`]{2,})`|["']([^"']{2,})["']|\b(?:[A-Z][A-Za-z0-9]+(?:[ -][A-Z][A-Za-z0-9]+)*)\b|\b\d+(?:\s*(?:hours?|days?|columns?))?\b/g)) { const value = (match[1] ?? match[2] ?? match[0]).trim().toLowerCase(); if (value.length >= 2) anchors.add(value); }
    return [...anchors].every(anchor => output.includes(anchor));
  }
  private estimateTokens(text: string): number {
    const chars = text.length;
    const words = text.trim() ? text.trim().split(/\s+/).length : 0;
    return Math.ceil(Math.max(chars / 6, words * 1.25));
  }
  private stripPresentationMarkup(prompt: string): string { return prompt.replace(/^\s*#{1,6}\s+/gm, "").replace(/\*\*/g, "").replace(/^\s*[-*]\s+/gm, "").replace(/^\s*\d+[.)]\s+/gm, "").replace(/\n{3,}/g, "\n\n").trim(); }
}
