import { PromptAstDocument, PromptAstNode, PromptAstNodeKind } from "../../analysis/promptAst";
import { PromptAstParser } from "../../analysis/promptAstParser";
import { PromptContextOptimizerService } from "../context/promptContextOptimizerService";
import { PromptDuplicateDetectionService } from "../duplicates/promptDuplicateDetectionService";

export type DeadCodeImpact = "critical" | "medium" | "low";
export type DeadCodeCategory = "repeated-emphasis" | "redundant-adjectives" | "duplicate-instructions" | "unused-context" | "long-introduction";

export interface DeadCodeEvidence {
  readonly lineStart: number;
  readonly lineEnd: number;
  readonly text: string;
}

export interface DeadCodeFinding {
  readonly id: string;
  readonly category: DeadCodeCategory;
  readonly title: string;
  readonly impact: DeadCodeImpact;
  readonly estimatedTokenSavings: number;
  readonly confidence: number;
  readonly evidence: DeadCodeEvidence;
  readonly reason: string;
  readonly recommendation: string;
  readonly neverRemoveAutomatically: true;
}

export interface DeadCodeEliminationReport {
  readonly generatedAt: string;
  readonly prompt: string;
  readonly method: "experimental";
  readonly blockCount: number;
  readonly findingCount: number;
  readonly criticalCount: number;
  readonly mediumCount: number;
  readonly lowCount: number;
  readonly estimatedTotalSavingsTokens: number;
  readonly findings: readonly DeadCodeFinding[];
}

const EMPHASIS_TERMS = ["important", "critical", "essential", "must", "absolutely", "very", "really", "extremely", "highly", "strongly"];
const ADJECTIVES = ["redundant", "robust", "efficient", "effective", "simple", "clear", "concise", "detailed", "comprehensive", "useful", "helpful", "powerful", "important"];

export class PromptDeadCodeEliminationService {
  private readonly parser = new PromptAstParser();
  private readonly duplicateDetection = new PromptDuplicateDetectionService();
  private readonly contextOptimizer = new PromptContextOptimizerService();

  analyze(prompt: string): DeadCodeEliminationReport {
    const ast = this.parser.parse(prompt);
    const findings = this.collectFindings(ast, prompt);
    const deduped = this.deduplicate(findings);
    const ranked = deduped.sort((left, right) => this.impactWeight(right.impact) - this.impactWeight(left.impact) || right.estimatedTokenSavings - left.estimatedTokenSavings);
    const counts = this.countImpacts(ranked);
    const estimatedTotalSavingsTokens = ranked.reduce((sum, finding) => sum + finding.estimatedTokenSavings, 0);

    return {
      generatedAt: new Date().toISOString(),
      prompt,
      method: "experimental",
      blockCount: ast.children.length,
      findingCount: ranked.length,
      criticalCount: counts.critical,
      mediumCount: counts.medium,
      lowCount: counts.low,
      estimatedTotalSavingsTokens,
      findings: ranked
    };
  }

  parse(prompt: string): PromptAstDocument {
    return this.parser.parse(prompt);
  }

  private collectFindings(ast: PromptAstDocument, prompt: string): DeadCodeFinding[] {
    const findings: DeadCodeFinding[] = [];

    findings.push(...this.repeatedEmphasisFindings(ast.children));
    findings.push(...this.redundantAdjectiveFindings(ast.children));
    findings.push(...this.duplicateInstructionFindings(prompt));
    findings.push(...this.unusedContextFindings(prompt));
    findings.push(...this.longIntroductionFindings(ast.children));

    return findings;
  }

  private repeatedEmphasisFindings(nodes: readonly PromptAstNode[]): DeadCodeFinding[] {
    const findings: DeadCodeFinding[] = [];
    for (const node of nodes) {
      const text = node.text.trim();
      if (!text) continue;

      const emphasisCount = this.countRepeatedTerms(text.toLowerCase(), EMPHASIS_TERMS);
      const exclamationBoost = (text.match(/!+/g)?.length ?? 0) > 0 ? 2 : 0;
      const repeatedPhrases = /(very|really|extremely|highly|strongly)\s+\1/i.test(text) ? 2 : 0;
      const score = emphasisCount + exclamationBoost + repeatedPhrases;
      if (score <= 2) continue;

      const savings = Math.max(2, Math.round(Math.min(node.tokenCount * 0.18, score * 2)));
      findings.push(this.finding({
        category: "repeated-emphasis",
        title: "Repeated emphasis",
        impact: score >= 6 ? "critical" : score >= 4 ? "medium" : "low",
        estimatedTokenSavings: savings,
        confidence: Math.min(0.95, 0.45 + score * 0.08),
        evidence: { lineStart: node.lineStart, lineEnd: node.lineEnd, text },
        reason: "The instruction repeats emphasis words or punctuation and may be louder than necessary.",
        recommendation: "Keep one clear emphasis phrase and remove repeated stress markers or duplicate emphasis.",
      }));
    }
    return findings;
  }

  private redundantAdjectiveFindings(nodes: readonly PromptAstNode[]): DeadCodeFinding[] {
    const findings: DeadCodeFinding[] = [];
    for (const node of nodes) {
      const text = node.text.trim();
      if (!text) continue;

      const matches = this.matchesAny(text.toLowerCase(), ADJECTIVES);
      if (matches < 2) continue;

      const savings = Math.max(1, Math.round(matches * 1.2));
      findings.push(this.finding({
        category: "redundant-adjectives",
        title: "Redundant adjectives",
        impact: matches >= 5 ? "medium" : "low",
        estimatedTokenSavings: savings,
        confidence: Math.min(0.9, 0.5 + matches * 0.06),
        evidence: { lineStart: node.lineStart, lineEnd: node.lineEnd, text },
        reason: "Adjectives or qualifiers repeat without materially changing the instruction.",
        recommendation: "Trim repeated descriptors and keep the instruction focused on the task or constraint.",
      }));
    }
    return findings;
  }

  private duplicateInstructionFindings(prompt: string): DeadCodeFinding[] {
    const report = this.duplicateDetection.detect(prompt);
    return report.matches.slice(0, 5).map((match, index) => this.finding({
      category: "duplicate-instructions",
      title: "Duplicate instructions",
      impact: match.similarityPercent >= 75 ? "critical" : "medium",
      estimatedTokenSavings: Math.max(2, match.potentialSavingsTokens),
      confidence: Math.min(0.97, match.similarityPercent / 100),
      evidence: {
        lineStart: Math.min(match.left.lineStart, match.right.lineStart),
        lineEnd: Math.max(match.left.lineEnd, match.right.lineEnd),
        text: `${match.left.text}\n---\n${match.right.text}`
      },
      reason: match.reason,
      recommendation: match.mergeSuggestion,
      suffix: `${index + 1}`
    }));
  }

  private unusedContextFindings(prompt: string): DeadCodeFinding[] {
    const report = this.contextOptimizer.optimize(prompt);
    return report.suggestions.slice(0, 6).map((suggestion, index) => this.finding({
      category: "unused-context",
      title: "Unused context",
      impact: suggestion.savingsPercent >= 55 ? "critical" : suggestion.savingsPercent >= 30 ? "medium" : "low",
      estimatedTokenSavings: Math.max(1, suggestion.removableTokens),
      confidence: Math.min(0.93, 0.5 + suggestion.relevancePercent / 250),
      evidence: {
        lineStart: suggestion.block.lineStart,
        lineEnd: suggestion.block.lineEnd,
        text: suggestion.block.text
      },
      reason: suggestion.reason,
      recommendation: `${suggestion.removeSuggestion} ${suggestion.keepHint}`,
      suffix: `${index + 1}`
    }));
  }

  private longIntroductionFindings(nodes: readonly PromptAstNode[]): DeadCodeFinding[] {
    const first = nodes.find(node => node.text.trim().length > 0);
    if (!first) {
      return [];
    }

    const introWords = first.text.trim().split(/\s+/).length;
    const isIntroLike = first.lineStart <= 2 && (first.kind === "paragraph" || first.kind === "context" || first.kind === "notes" || first.kind === "metadata");
    if (!isIntroLike || introWords < 24) {
      return [];
    }

    const savings = Math.max(4, Math.round(first.tokenCount * 0.4));
    return [this.finding({
      category: "long-introduction",
      title: "Long introduction",
      impact: introWords >= 60 ? "critical" : introWords >= 35 ? "medium" : "low",
      estimatedTokenSavings: savings,
      confidence: 0.8,
      evidence: { lineStart: first.lineStart, lineEnd: first.lineEnd, text: first.text },
      reason: "The opening block is long and may contain setup that does not materially affect the task.",
      recommendation: "Shorten the introduction and keep only details that change the final instruction or output.",
    })];
  }

  private finding(input: {
    category: DeadCodeCategory;
    title: string;
    impact: DeadCodeImpact;
    estimatedTokenSavings: number;
    confidence: number;
    evidence: DeadCodeEvidence;
    reason: string;
    recommendation: string;
    suffix?: string;
  }): DeadCodeFinding {
    return {
      id: `${input.category}-${input.evidence.lineStart}-${input.evidence.lineEnd}${input.suffix ? `-${input.suffix}` : ""}`,
      category: input.category,
      title: input.title,
      impact: input.impact,
      estimatedTokenSavings: input.estimatedTokenSavings,
      confidence: input.confidence,
      evidence: input.evidence,
      reason: input.reason,
      recommendation: input.recommendation,
      neverRemoveAutomatically: true
    };
  }

  private deduplicate(findings: readonly DeadCodeFinding[]): DeadCodeFinding[] {
    const seen = new Set<string>();
    const unique: DeadCodeFinding[] = [];
    for (const finding of findings) {
      const key = `${finding.category}:${finding.evidence.lineStart}:${finding.evidence.lineEnd}:${finding.title}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      unique.push(finding);
    }
    return unique;
  }

  private countImpacts(findings: readonly DeadCodeFinding[]): { critical: number; medium: number; low: number } {
    return findings.reduce((accumulator, finding) => {
      accumulator[finding.impact] += 1;
      return accumulator;
    }, { critical: 0, medium: 0, low: 0 });
  }

  private impactWeight(impact: DeadCodeImpact): number {
    return impact === "critical" ? 3 : impact === "medium" ? 2 : 1;
  }

  private matchesAny(text: string, terms: readonly string[]): number {
    return terms.reduce((count, term) => count + (new RegExp(`\\b${term}\\b`, "gi").test(text) ? 1 : 0), 0);
  }

  private countRepeatedTerms(text: string, terms: readonly string[]): number {
    return terms.reduce((count, term) => count + ((text.match(new RegExp(`\\b${term}\\b`, "gi"))?.length ?? 0) > 1 ? 1 : 0), 0);
  }
}