import { PromptAstNode, PromptAstNodeKind } from "../../analysis/promptAst";
import { PromptAstParser } from "../../analysis/promptAstParser";

export interface DuplicateBlockSummary {
  readonly kind: PromptAstNodeKind;
  readonly label: string;
  readonly text: string;
  readonly tokenCount: number;
  readonly lineStart: number;
  readonly lineEnd: number;
}

export interface DuplicateBlockMatch {
  readonly left: DuplicateBlockSummary;
  readonly right: DuplicateBlockSummary;
  readonly similarityPercent: number;
  readonly potentialSavingsTokens: number;
  readonly mergeSuggestion: string;
  readonly reason: string;
  readonly method: "lightweight";
}

export interface DuplicateDetectionReport {
  readonly generatedAt: string;
  readonly prompt: string;
  readonly blockCount: number;
  readonly matchCount: number;
  readonly method: "lightweight";
  readonly matches: DuplicateBlockMatch[];
}

const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "has", "have", "i", "in", "is", "it", "its", "of", "on", "or", "that", "the", "this", "to", "was", "we", "with", "you", "your"
]);

export class PromptDuplicateDetectionService {
  private readonly parser = new PromptAstParser();

  detect(prompt: string): DuplicateDetectionReport {
    const ast = this.parser.parse(prompt);
    const blocks = this.semanticBlocks(ast.children);
    const matches = this.findMatches(blocks);

    return {
      generatedAt: new Date().toISOString(),
      prompt,
      blockCount: blocks.length,
      matchCount: matches.length,
      method: "lightweight",
      matches
    };
  }

  private semanticBlocks(nodes: readonly PromptAstNode[]): DuplicateBlockSummary[] {
    return nodes
      .filter(node => node.text.trim().length > 0)
      .map(node => ({
        kind: node.kind,
        label: this.labelFor(node),
        text: node.text,
        tokenCount: node.tokenCount,
        lineStart: node.lineStart,
        lineEnd: node.lineEnd
      }));
  }

  private findMatches(blocks: readonly DuplicateBlockSummary[]): DuplicateBlockMatch[] {
    const matches: DuplicateBlockMatch[] = [];
    for (let leftIndex = 0; leftIndex < blocks.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < blocks.length; rightIndex += 1) {
        const left = blocks[leftIndex]!;
        const right = blocks[rightIndex]!;
        const similarity = this.similarity(left.text, right.text, left.kind === right.kind);
        if (similarity < 0.32) {
          continue;
        }

        matches.push({
          left,
          right,
          similarityPercent: Math.round(similarity * 100),
          potentialSavingsTokens: this.estimateSavings(left, right, similarity),
          mergeSuggestion: this.mergeSuggestion(left, right),
          reason: this.reasonFor(left, right, similarity),
          method: "lightweight"
        });
      }
    }

    return matches.sort((left, right) => right.similarityPercent - left.similarityPercent || right.potentialSavingsTokens - left.potentialSavingsTokens).slice(0, 8);
  }

  private similarity(leftText: string, rightText: string, sameKind: boolean): number {
    const leftTokens = this.significantTokens(leftText);
    const rightTokens = this.significantTokens(rightText);
    const tokenScore = this.jaccard(leftTokens, rightTokens);
    const ngramScore = this.jaccard(this.charNgrams(leftText), this.charNgrams(rightText));
    const lengthScore = 1 - Math.min(1, Math.abs(leftTokens.size - rightTokens.size) / Math.max(leftTokens.size, rightTokens.size, 1));
    const kindBonus = sameKind ? 0.08 : 0;
    return Math.min(1, tokenScore * 0.52 + ngramScore * 0.3 + lengthScore * 0.12 + kindBonus);
  }

  private estimateSavings(left: DuplicateBlockSummary, right: DuplicateBlockSummary, similarity: number): number {
    return Math.max(0, Math.round(Math.min(left.tokenCount, right.tokenCount) * similarity * 0.6));
  }

  private mergeSuggestion(left: DuplicateBlockSummary, right: DuplicateBlockSummary): string {
    const dominant = left.tokenCount >= right.tokenCount ? left : right;
    const other = dominant === left ? right : left;
    return `Merge the ${other.label.toLowerCase()} ideas into ${dominant.label.toLowerCase()}. Keep the more specific wording from ${dominant.label.toLowerCase()} and remove repeated ideas from ${other.label.toLowerCase()}.`;
  }

  private reasonFor(left: DuplicateBlockSummary, right: DuplicateBlockSummary, similarity: number): string {
    const shared = [...this.significantTokens(left.text)].filter(token => this.significantTokens(right.text).has(token)).slice(0, 4);
    const sharedText = shared.length ? `Shared concepts: ${shared.join(", ")}.` : "Shared phrasing across the two blocks.";
    return `${sharedText} Lightweight similarity score: ${Math.round(similarity * 100)}%.`;
  }

  private labelFor(node: PromptAstNode): string {
    switch (node.kind) {
      case "role": return "Role";
      case "context": return "Context";
      case "task": return "Task";
      case "constraints": return "Constraints";
      case "examples": return "Examples";
      case "output-format": return "Output format";
      case "notes": return "Notes";
      case "metadata": return "Metadata";
      case "paragraph": return `Paragraph ${node.lineStart}`;
      case "bullet": return `Bullet ${node.lineStart}`;
      default: return node.kind;
    }
  }

  private significantTokens(text: string): Set<string> {
    return new Set(
      text
        .toLowerCase()
        .match(/[\p{L}\p{N}_'-]+/gu)
        ?.map(token => token.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""))
        .map(token => token.replace(/(?:'s|s)$/u, ""))
        .filter(token => token.length > 2 && !STOPWORDS.has(token)) ?? []
    );
  }

  private charNgrams(text: string): Set<string> {
    const normalized = text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
    const grams = new Set<string>();
    for (let index = 0; index <= normalized.length - 3; index += 1) {
      grams.add(normalized.slice(index, index + 3));
    }
    return grams;
  }

  private jaccard(left: Set<string>, right: Set<string>): number {
    if (!left.size || !right.size) {
      return 0;
    }

    let intersection = 0;
    for (const value of left) {
      if (right.has(value)) {
        intersection += 1;
      }
    }

    const union = left.size + right.size - intersection;
    return union === 0 ? 0 : intersection / union;
  }
}