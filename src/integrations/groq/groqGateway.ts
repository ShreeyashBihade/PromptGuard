import { AnalysisResult } from "../../types";
import { GroqClient } from "./groqClient";

const INPUT_PER_MILLION = 0.075;
const OUTPUT_PER_MILLION = 0.30;
const analysisInstruction = "You are a rigorous prompt-reviewer. Assess only genuinely ambiguous, contradictory, underspecified, or risky intent. Be concise. Return headings: Verdict, Risks, Missing context, Recommended changes.";
export class GroqGateway {
  constructor(private readonly client = new GroqClient()) {}
  shouldReview(result: AnalysisResult): boolean {
    const dicey = result.issues.some(issue => ["ambiguous-language", "weak-verbs", "repeated-information", "missing-constraints"].includes(issue.ruleId));
    const originalCost = result.cost.estimatedCostUsd;
    return dicey && originalCost !== undefined && this.forecast(result.prompt, 350) < originalCost;
  }
  async review(prompt: string): Promise<{ review: string; costUsd: number }> { const answer = await this.client.complete(analysisInstruction, prompt, 350); return { review: answer.content, costUsd: this.cost(answer.usage.promptTokens, answer.usage.completionTokens) }; }
  async isConfigured(): Promise<boolean> { return this.client.isConfigured(); }
  async judge(prompt: string, localFindings: readonly string[]): Promise<{ score: number; rationale: string; costUsd: number }> {
    const answer = await this.client.complete("You are a strict senior prompt engineer. Judge whether the prompt is sufficient to reliably complete its task. A vague request such as 'make a webpage' must score low because it lacks purpose, audience, design, functionality, technical constraints, and output expectations. Return valid JSON only: {\"score\":number 0-100,\"rationale\":\"concise explanation\"}. Consider the local findings but independently identify missing context.", `Prompt:\n${prompt}\n\nLocal findings:\n${localFindings.join("\n") || "None"}`, 180);
    try { const parsed = JSON.parse(answer.content.replace(/^```json\s*|\s*```$/g, "")) as { score?: unknown; rationale?: unknown }; const score = typeof parsed.score === "number" ? Math.max(0, Math.min(100, Math.round(parsed.score))) : 50; return { score, rationale: typeof parsed.rationale === "string" ? parsed.rationale : "AI review completed.", costUsd: this.cost(answer.usage.promptTokens, answer.usage.completionTokens) }; } catch { return { score: 50, rationale: "AI review returned an unreadable assessment.", costUsd: this.cost(answer.usage.promptTokens, answer.usage.completionTokens) }; }
  }
  async improve(prompt: string): Promise<{ improvedPrompt: string; costUsd: number }> {
    const answer = await this.client.complete("You improve prompts without changing their intent. Return only a polished prompt. If critical context is absent, include a short 'Before answering, ask:' section with targeted questions covering purpose (work, local, home, school), intended audience, tech stack, operating system/environment, constraints, output format, and success criteria.", prompt, 700);
    return { improvedPrompt: answer.content, costUsd: this.cost(answer.usage.promptTokens, answer.usage.completionTokens) };
  }
  async ask(instruction: string, prompt: string, maxTokens: number): Promise<{ content: string; costUsd: number }> { const answer = await this.client.complete(instruction, prompt, maxTokens); return { content: answer.content, costUsd: this.cost(answer.usage.promptTokens, answer.usage.completionTokens) }; }
  async improveWithContext(prompt: string, context: string, findings: readonly string[]): Promise<{ improvedPrompt: string; costUsd: number }> {
    const answer = await this.client.complete("You improve prompts without changing their intent. Return only the final polished prompt. Incorporate the user's clarification choices as binding requirements. You MUST resolve every listed PromptGuard finding by adding concrete role/context, constraints, output structure, examples, safety boundaries, or specificity as appropriate. Do not mention the findings or ask more questions.", `Original prompt:\n${prompt}\n\nClarifications:\n${context}\n\nFindings that must be resolved:\n${findings.join("\n")}`, 700);
    return { improvedPrompt: answer.content, costUsd: this.cost(answer.usage.promptTokens, answer.usage.completionTokens) };
  }
  private forecast(prompt: string, maxOutput: number): number { return this.cost(Math.ceil((prompt.length + analysisInstruction.length) / 4), maxOutput); }
  private cost(input: number, output: number): number { return input * INPUT_PER_MILLION / 1_000_000 + output * OUTPUT_PER_MILLION / 1_000_000; }
}
