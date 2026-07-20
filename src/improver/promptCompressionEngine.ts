import { PromptAstParser } from "../analysis/promptAstParser";
import { OptimizationDiffView } from "../types";

export interface CompressionStep {
  readonly label: string;
  readonly description: string;
  readonly tokensSaved: number;
}

export interface CompressionPreview {
  readonly optimizedPrompt: string;
  readonly reason: string;
  readonly confidence: number;
  readonly estimatedTokenSavings: number;
  readonly diff: string;
  readonly diffView: OptimizationDiffView;
  readonly steps: CompressionStep[];
}

export class PromptCompressionEngine {
  private readonly astParser = new PromptAstParser();
  private readonly phraseReplacements: ReadonlyArray<{ from: RegExp; to: string; label: string }> = [
    { from: /\bplease make sure you should\b/gi, to: "Must", label: "Replace hedging directives" },
    { from: /\bplease ensure you should\b/gi, to: "Must", label: "Replace hedging directives" },
    { from: /\bplease make sure(?: that)?\b/gi, to: "Must", label: "Replace hedging directives" },
    { from: /\byou should(?: that)?\b/gi, to: "Must", label: "Replace weak directives" },
    { from: /\bplease ensure(?: that)?\b/gi, to: "Must", label: "Replace hedging directives" },
    { from: /\bi would like you to\b/gi, to: "", label: "Remove filler" },
    { from: /\bi need you to\b/gi, to: "", label: "Remove filler" },
    { from: /\bwe need to\b/gi, to: "", label: "Remove filler" },
    { from: /\bcan you\b/gi, to: "", label: "Remove filler" },
    { from: /\bin order to\b/gi, to: "to", label: "Shorten verbose wording" },
    { from: /\bdue to the fact that\b/gi, to: "because", label: "Shorten verbose wording" },
    { from: /\bat this point in time\b/gi, to: "now", label: "Shorten verbose wording" },
    { from: /\bwith respect to\b/gi, to: "regarding", label: "Shorten verbose wording" },
    { from: /\bin the context of\b/gi, to: "for", label: "Shorten verbose wording" },
    { from: /\bin the event that\b/gi, to: "if", label: "Shorten verbose wording" },
    { from: /\bthe purpose of\b/gi, to: "purpose of", label: "Shorten verbose wording" }
  ];

  compress(prompt: string): CompressionPreview {
    this.astParser.parse(prompt);
    const originalTokens = this.estimateTokens(prompt);

    const steps: CompressionStep[] = [];
    let optimized = this.normalizeWhitespace(prompt);

    optimized = this.applyPhraseReplacements(optimized, steps, originalTokens);
    optimized = this.removeFiller(optimized, steps, originalTokens);
    optimized = this.collapseRepeatedConstraints(optimized, steps, originalTokens);
    optimized = this.deduplicateLines(optimized, steps, originalTokens);
    optimized = this.normalizeWhitespace(optimized);

    const optimizedTokens = this.estimateTokens(optimized);
    const estimatedTokenSavings = Math.max(0, originalTokens - optimizedTokens);
    if (estimatedTokenSavings > 0) {
      steps.push({ label: "Finalize preview", description: "Normalized spacing after deterministic rewrites.", tokensSaved: estimatedTokenSavings });
    }

    return {
      optimizedPrompt: optimized,
      reason: steps.length ? this.describeSteps(steps) : "Prompt is already compact enough.",
      confidence: this.estimateConfidence(originalTokens, optimizedTokens, steps.length),
      estimatedTokenSavings,
      diff: this.buildDiff(prompt, optimized),
      diffView: this.buildDiffView(prompt, optimized, estimatedTokenSavings),
      steps
    };
  }

  private applyPhraseReplacements(prompt: string, steps: CompressionStep[], originalTokens: number): string {
    let current = prompt;
    for (const replacement of this.phraseReplacements) {
      const next = current.replace(replacement.from, replacement.to);
      current = this.recordStep(steps, originalTokens, current, next, replacement.label, this.describeReplacement(replacement));
    }
    current = current.replace(/\bMust\s+Must\b/gi, "Must");
    return current;
  }

  private removeFiller(prompt: string, steps: CompressionStep[], originalTokens: number): string {
    const next = prompt
      .replace(/\b(please|kindly|just|simply|really|basically|actually)\s+/gi, "")
      .replace(/\b([A-Za-z]{3,})\s+\1\b/gi, "$1");
    return this.recordStep(steps, originalTokens, prompt, next, "Remove filler", "Removed filler and repeated words.");
  }

  private collapseRepeatedConstraints(prompt: string, steps: CompressionStep[], originalTokens: number): string {
    const lines = prompt.split(/\r?\n/);
    const seen = new Set<string>();
    const kept = lines.filter(line => {
      const trimmed = line.trim();
      if (!trimmed) return true;
      if (!this.looksLikeConstraint(trimmed)) return true;
      const normalized = trimmed.toLowerCase().replace(/^[-*+•]\s*/, "").replace(/^(must|should|must not|do not|don't|avoid|only|limit|include|exclude|require|required)\s*/i, "").replace(/\s+/g, " ").trim();
      if (!normalized) return true;
      if (seen.has(normalized)) return false;
      seen.add(normalized);
      return true;
    });
    const next = kept.join("\n");
    return this.recordStep(steps, originalTokens, prompt, next, "Collapse repeated constraints", "Collapsed repeated constraint lines and bullets.");
  }

  private deduplicateLines(prompt: string, steps: CompressionStep[], originalTokens: number): string {
    const seen = new Set<string>();
    const next = prompt
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => {
        const normalized = line.replace(/\s+/g, " ").toLowerCase();
        if (!normalized) return false;
        if (seen.has(normalized)) return false;
        seen.add(normalized);
        return true;
      })
      .join("\n");
      return this.recordStep(steps, originalTokens, prompt, next, "Deduplicate lines", "Removed repeated lines and excess spacing.");
  }

  private normalizeWhitespace(prompt: string): string {
    return prompt
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/\s+([,.;:!?])/g, "$1")
      .replace(/([,.;:!?])(\S)/g, "$1 $2")
      .trim();
  }

  private recordStep(steps: CompressionStep[], originalTokens: number, before: string, after: string, label: string, description: string): string {
    if (before === after) {
      return after;
    }

    const saved = Math.max(0, this.estimateTokens(before) - this.estimateTokens(after));
    if (saved > 0) {
      steps.push({ label, description, tokensSaved: saved });
    }

    return after;
  }

  private describeReplacement(replacement: { from: RegExp; to: string; label: string }): string {
    if (replacement.to === "Must") {
      return "Replaced weak or hedging directives with a direct imperative.";
    }
    if (!replacement.to) {
      return "Removed filler wording without changing the task.";
    }
    return `Replaced verbose wording with \"${replacement.to}\".`;
  }

  private looksLikeConstraint(line: string): boolean {
    return /\b(must|must not|should|should not|avoid|limit|only|exactly|include|exclude|require|required|no more than|at most|under)\b/i.test(line);
  }

  private describeSteps(steps: CompressionStep[]): string {
    return steps.map(step => `${step.label}: ${step.description}`).join(" ");
  }

  private estimateConfidence(originalTokens: number, optimizedTokens: number, stepCount: number): number {
    if (originalTokens <= 0 || optimizedTokens >= originalTokens) return 0.24;
    const savingsRatio = (originalTokens - optimizedTokens) / originalTokens;
    return Math.min(0.95, 0.42 + savingsRatio * 0.45 + Math.min(0.2, stepCount * 0.06));
  }

  private buildDiff(originalPrompt: string, optimizedPrompt: string): string {
    const originalLines = originalPrompt.split(/\r?\n/);
    const optimizedLines = optimizedPrompt.split(/\r?\n/);
    const diffLines: string[] = [];
    const maxLength = Math.max(originalLines.length, optimizedLines.length);
    for (let index = 0; index < maxLength; index += 1) {
      const originalLine = originalLines[index];
      const optimizedLine = optimizedLines[index];
      if (originalLine === optimizedLine) {
        if (originalLine !== undefined) diffLines.push(`  ${originalLine}`);
        continue;
      }
      if (originalLine !== undefined) diffLines.push(`- ${originalLine}`);
      if (optimizedLine !== undefined) diffLines.push(`+ ${optimizedLine}`);
    }
    return diffLines.join("\n");
  }

  private buildDiffView(originalPrompt: string, optimizedPrompt: string, totalTokenSavings: number): OptimizationDiffView {
    const originalLines = this.normalizeDiffLines(originalPrompt);
    const optimizedLines = this.normalizeDiffLines(optimizedPrompt);
    const maxLength = Math.max(originalLines.length, optimizedLines.length);
    const changes: OptimizationDiffView["changes"] extends readonly (infer Change)[] ? Change[] : never[] = [];
    let acceptedPromptLines: string[] = [];

    for (let index = 0; index < maxLength; index += 1) {
      const originalLine = originalLines[index];
      const optimizedLine = optimizedLines[index];

      if (originalLine === optimizedLine) {
        if (originalLine !== undefined) {
          acceptedPromptLines.push(originalLine);
        }
        continue;
      }

      const changeId = `change-${index + 1}`;
      if (originalLine !== undefined && optimizedLine !== undefined) {
        const tokenSavings = this.estimateTokens(originalLine) - this.estimateTokens(optimizedLine);
        const accepted = true;
        changes.push({ id: changeId, type: "modified", lineNumber: index + 1, originalText: originalLine, optimizedText: optimizedLine, tokenSavings, costSavingsUsd: this.tokensToCost(tokenSavings), accepted });
        acceptedPromptLines.push(optimizedLine);
        continue;
      }

      if (originalLine !== undefined) {
        const tokenSavings = this.estimateTokens(originalLine);
        changes.push({ id: changeId, type: "removed", lineNumber: index + 1, originalText: originalLine, tokenSavings, costSavingsUsd: this.tokensToCost(tokenSavings), accepted: true });
        continue;
      }

      if (optimizedLine !== undefined) {
        const tokenSavings = -this.estimateTokens(optimizedLine);
        changes.push({ id: changeId, type: "added", lineNumber: index + 1, optimizedText: optimizedLine, tokenSavings, costSavingsUsd: this.tokensToCost(tokenSavings), accepted: true });
        acceptedPromptLines.push(optimizedLine);
      }
    }

    return {
      totalTokenSavings,
      totalCostSavingsUsd: this.tokensToCost(totalTokenSavings),
      changes,
      acceptedOptimizedPrompt: acceptedPromptLines.join("\n")
    };
  }

  private normalizeDiffLines(prompt: string): string[] {
    return prompt.split(/\r?\n/).map(line => line.trimEnd());
  }

  private estimateTokens(text: string): number {
    const words = text.trim() ? text.trim().split(/\s+/).length : 0;
    return Math.max(0, Math.ceil(Math.max(text.length / 6, words * 1.15)));
  }

  private tokensToCost(tokens: number): number {
    return tokens * 0.000000075;
  }
}
