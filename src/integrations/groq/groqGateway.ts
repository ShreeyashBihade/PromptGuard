import { AnalysisResult } from "../../types";
import { GroqClient } from "./groqClient";
import { GROQ_CLARIFY_SYSTEM_PROMPT, GROQ_JUDGEMENT_SYSTEM_PROMPT, GROQ_REVIEW_SYSTEM_PROMPT, GROQ_TOKEN_MINIMIZER_SYSTEM_PROMPT } from "./systemPrompts";

const INPUT_PER_MILLION = 0.075;
const OUTPUT_PER_MILLION = 0.30;
export class GroqGateway {
  constructor(private readonly client = new GroqClient()) {}
  shouldReview(result: AnalysisResult): boolean {
    const dicey = result.issues.some(issue => ["ambiguous-language", "weak-verbs", "repeated-information", "missing-constraints"].includes(issue.ruleId));
    const originalCost = result.cost.estimatedCostUsd;
    return dicey && originalCost !== undefined && this.forecast(result.prompt, GROQ_REVIEW_SYSTEM_PROMPT, 350) < originalCost;
  }
  async review(prompt: string): Promise<{ review: string; costUsd: number }> { const answer = await this.client.complete(GROQ_REVIEW_SYSTEM_PROMPT, prompt, 350); return { review: answer.content, costUsd: this.cost(answer.usage.promptTokens, answer.usage.completionTokens) }; }
  async isConfigured(): Promise<boolean> { return this.client.isConfigured(); }
  async judge(prompt: string, localFindings: readonly string[]): Promise<{ score: number; rationale: string; costUsd: number }> {
    const payload = `Prompt:\n${prompt}\n\nLocal findings:\n${localFindings.join("\n") || "None"}`;
    const first = await this.client.complete(GROQ_JUDGEMENT_SYSTEM_PROMPT, payload, 180);
    const parsed = this.parseJudgement(first.content);
    if (parsed) return { ...parsed, costUsd: this.cost(first.usage.promptTokens, first.usage.completionTokens) };
    const retry = await this.client.complete(`${GROQ_JUDGEMENT_SYSTEM_PROMPT} Your previous response was invalid. Return exactly one JSON object and nothing else.`, payload, 180);
    const retried = this.parseJudgement(retry.content);
    if (!retried) throw new Error("Groq returned an invalid semantic judgement.");
    return { ...retried, costUsd: this.cost(first.usage.promptTokens + retry.usage.promptTokens, first.usage.completionTokens + retry.usage.completionTokens) };
  }
  async improve(prompt: string): Promise<{ improvedPrompt: string; costUsd: number }> {
    const answer = await this.client.complete("You improve prompts without changing their intent. Return only a polished prompt. If critical context is absent, include a short 'Before answering, ask:' section with targeted questions covering purpose (work, local, home, school), intended audience, tech stack, operating system/environment, constraints, output format, and success criteria.", prompt, 700);
    return { improvedPrompt: answer.content, costUsd: this.cost(answer.usage.promptTokens, answer.usage.completionTokens) };
  }
  async ask(instruction: string, prompt: string, maxTokens: number): Promise<{ content: string; costUsd: number }> { const answer = await this.client.complete(instruction, prompt, maxTokens); return { content: answer.content, costUsd: this.cost(answer.usage.promptTokens, answer.usage.completionTokens) }; }
  async improveWithContext(prompt: string, context: string, findings: readonly string[], mode: "clarify" | "compress"): Promise<{ improvedPrompt: string; costUsd: number; outputTokens: number }> {
    const completionBudget = mode === "clarify"
      ? Math.min(2_400, Math.max(900, Math.ceil((prompt.length + context.length) / 2.5)))
      : Math.min(4_000, Math.max(800, Math.ceil(prompt.length / 3)));
    if (mode === "compress") return this.optimizeForTokenReduction(prompt, context, findings, completionBudget);
    const payload = `<original_prompt>\n${prompt}\n</original_prompt>\n\n<clarifications>\n${context || "None"}\n</clarifications>`;
    const first = await this.client.complete(GROQ_CLARIFY_SYSTEM_PROMPT, payload, completionBudget);

    if (!this.likelyTruncated(first.content, first.usage.completionTokens, completionBudget)) {
      return { improvedPrompt: first.content, costUsd: this.cost(first.usage.promptTokens, first.usage.completionTokens), outputTokens: first.usage.completionTokens };
    }

    try {
      const continuation = await this.client.completeMessages([
        { role: "system", content: GROQ_CLARIFY_SYSTEM_PROMPT },
        { role: "user", content: payload },
        { role: "assistant", content: first.content },
        { role: "user", content: "Continue exactly from where you stopped. Return only the continuation text with no preface and no markdown." }
      ], Math.max(500, Math.floor(completionBudget * 0.75)));

      const merged = `${first.content.trim()} ${continuation.content.trim()}`.trim();
      return {
        improvedPrompt: merged,
        costUsd: this.cost(first.usage.promptTokens + continuation.usage.promptTokens, first.usage.completionTokens + continuation.usage.completionTokens),
        outputTokens: first.usage.completionTokens + continuation.usage.completionTokens
      };
    } catch {
      return { improvedPrompt: first.content, costUsd: this.cost(first.usage.promptTokens, first.usage.completionTokens), outputTokens: first.usage.completionTokens };
    }
  }
  private async optimizeForTokenReduction(prompt: string, context: string, findings: readonly string[], completionBudget: number): Promise<{ improvedPrompt: string; costUsd: number; outputTokens: number }> {
    const payload = `<original_prompt>\n${prompt}\n</original_prompt>\n\n<clarifications>\n${context || "None"}\n</clarifications>\n\n<findings_to_address>\n${findings.join("\n") || "None"}\n</findings_to_address>`;
    const first = await this.client.complete(GROQ_TOKEN_MINIMIZER_SYSTEM_PROMPT, payload, completionBudget);
    const firstParsed = this.parseTokenOptimizer(first.content);
    if (firstParsed) return { improvedPrompt: firstParsed, costUsd: this.cost(first.usage.promptTokens, first.usage.completionTokens), outputTokens: first.usage.completionTokens };

    const retry = await this.client.complete(`${GROQ_TOKEN_MINIMIZER_SYSTEM_PROMPT} Return exactly one valid JSON object and nothing else.`, payload, completionBudget);
    const retryParsed = this.parseTokenOptimizer(retry.content);
    if (!retryParsed) {
      const combinedCost = this.cost(first.usage.promptTokens + retry.usage.promptTokens, first.usage.completionTokens + retry.usage.completionTokens);
      return { improvedPrompt: first.content.trim() || prompt, costUsd: combinedCost, outputTokens: first.usage.completionTokens + retry.usage.completionTokens };
    }

    return {
      improvedPrompt: retryParsed,
      costUsd: this.cost(first.usage.promptTokens + retry.usage.promptTokens, first.usage.completionTokens + retry.usage.completionTokens),
      outputTokens: first.usage.completionTokens + retry.usage.completionTokens
    };
  }
  private forecast(prompt: string, instruction: string, maxOutput: number): number { return this.cost(Math.ceil((prompt.length + instruction.length) / 4), maxOutput); }
  private cost(input: number, output: number): number { return input * INPUT_PER_MILLION / 1_000_000 + output * OUTPUT_PER_MILLION / 1_000_000; }
  private likelyTruncated(content: string, outputTokens: number, budget: number): boolean {
    if (!content.trim()) return true;
    if (outputTokens < Math.max(200, budget - 35)) return false;
    return !/[.!?"')\]]\s*$/.test(content.trim());
  }
  private parseJudgement(source: string): { score: number; rationale: string } | undefined { const start = source.indexOf("{"); const end = source.lastIndexOf("}"); if (start < 0 || end <= start) return undefined; try { const value = JSON.parse(source.slice(start, end + 1)) as { score?: unknown; rationale?: unknown }; if (typeof value.score !== "number") return undefined; return { score: Math.max(0, Math.min(100, Math.round(value.score))), rationale: typeof value.rationale === "string" ? value.rationale : "Groq semantic judgement applied." }; } catch { return undefined; } }
  private parseTokenOptimizer(source: string): string | undefined {
    const start = source.indexOf("{"); const end = source.lastIndexOf("}"); if (start < 0 || end <= start) return undefined;
    try {
      const value = JSON.parse(source.slice(start, end + 1)) as { optimizedPrompt?: unknown; preservationCheck?: unknown };
      if (typeof value.optimizedPrompt !== "string") return undefined;
      const preserved = value.preservationCheck as { intentPreserved?: unknown; constraintsPreserved?: unknown; contextPreserved?: unknown } | undefined;
      if (!preserved || preserved.intentPreserved !== true || preserved.constraintsPreserved !== true || preserved.contextPreserved !== true) return undefined;
      return value.optimizedPrompt.trim();
    } catch {
      return undefined;
    }
  }
}
