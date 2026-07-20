import { PromptAstNode, PromptAstNodeKind } from "../../analysis/promptAst";
import { PromptAstParser } from "../../analysis/promptAstParser";

export interface ContextBlockSummary {
  readonly kind: PromptAstNodeKind;
  readonly label: string;
  readonly text: string;
  readonly tokenCount: number;
  readonly lineStart: number;
  readonly lineEnd: number;
}

export interface ContextOptimizationSuggestion {
  readonly block: ContextBlockSummary;
  readonly removableTokens: number;
  readonly relevancePercent: number;
  readonly savingsPercent: number;
  readonly reason: string;
  readonly removeSuggestion: string;
  readonly keepHint: string;
}

export interface ContextOptimizationReport {
  readonly generatedAt: string;
  readonly prompt: string;
  readonly blockCount: number;
  readonly suggestionCount: number;
  readonly method: "lightweight";
  readonly taskSummary: string;
  readonly suggestions: ContextOptimizationSuggestion[];
}

const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "has", "have", "i", "in", "is", "it", "its", "of", "on", "or", "that", "the", "this", "to", "was", "we", "with", "you", "your"
]);

const BLOCK_KIND_PRIORITY: Readonly<Record<PromptAstNodeKind, number>> = {
  document: 0,
  role: 0,
  context: 0.9,
  task: 0,
  constraints: 0,
  examples: 0.2,
  "output-format": 0,
  notes: 0.85,
  metadata: 0.75,
  paragraph: 0.7,
  bullet: 0.55
};

export class PromptContextOptimizerService {
  private readonly parser = new PromptAstParser();

  optimize(prompt: string): ContextOptimizationReport {
    const ast = this.parser.parse(prompt);
    const blocks = this.semanticBlocks(ast.children);
    const taskTokens = this.taskTokens(blocks);
    const suggestions = this.findSuggestions(blocks, taskTokens);

    return {
      generatedAt: new Date().toISOString(),
      prompt,
      blockCount: blocks.length,
      suggestionCount: suggestions.length,
      method: "lightweight",
      taskSummary: this.taskSummary(blocks),
      suggestions
    };
  }

  private semanticBlocks(nodes: readonly PromptAstNode[]): ContextBlockSummary[] {
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

  private taskTokens(blocks: readonly ContextBlockSummary[]): Set<string> {
    const taskLike = blocks.filter(block => block.kind === "task" || block.kind === "constraints" || block.kind === "output-format" || block.kind === "role");
    const source = taskLike.length ? taskLike : blocks;
    const tokens = new Set<string>();
    for (const block of source) {
      for (const token of this.significantTokens(block.text)) {
        tokens.add(token);
      }
    }
    return tokens;
  }

  private findSuggestions(blocks: readonly ContextBlockSummary[], taskTokens: Set<string>): ContextOptimizationSuggestion[] {
    const suggestions: ContextOptimizationSuggestion[] = [];

    for (const block of blocks) {
      if (block.kind === "task" || block.kind === "constraints" || block.kind === "output-format" || block.kind === "role") {
        continue;
      }

      const blockTokens = this.significantTokens(block.text);
      const relevance = this.jaccard(blockTokens, taskTokens);
      const priority = BLOCK_KIND_PRIORITY[block.kind];
      const removableScore = Math.max(0, 1 - relevance);
      const removableTokens = Math.max(0, Math.round(block.tokenCount * (0.55 + removableScore * 0.45)));

      if (block.tokenCount < 12 || removableScore < priority) {
        continue;
      }

      suggestions.push({
        block,
        removableTokens,
        relevancePercent: Math.round(relevance * 100),
        savingsPercent: Math.round((removableTokens / Math.max(block.tokenCount, 1)) * 100),
        reason: this.reasonFor(block, relevance),
        removeSuggestion: this.removeSuggestion(block),
        keepHint: this.keepHint(block)
      });
    }

    return suggestions
      .sort((left, right) => right.removableTokens - left.removableTokens || right.relevancePercent - left.relevancePercent)
      .slice(0, 8);
  }

  private taskSummary(blocks: readonly ContextBlockSummary[]): string {
    const taskBlock = blocks.find(block => block.kind === "task");
    if (!taskBlock) {
      return "No explicit task block found; scored against the strongest instruction blocks available.";
    }

    return taskBlock.text.length > 140 ? `${taskBlock.text.slice(0, 137)}...` : taskBlock.text;
  }

  private reasonFor(block: ContextBlockSummary, relevance: number): string {
    const score = Math.round(relevance * 100);
    if (score <= 10) {
      return "Very low overlap with the task and instruction blocks.";
    }
    if (score <= 25) {
      return "Low overlap with the task and likely removable background context.";
    }
    return "Only partially related to the task and worth reviewing for removal or trimming.";
  }

  private removeSuggestion(block: ContextBlockSummary): string {
    return `Remove the ${block.label.toLowerCase()} paragraph if it does not change the desired output.`;
  }

  private keepHint(block: ContextBlockSummary): string {
    return block.kind === "context"
      ? "Keep only if it contains task-critical details, domain constraints, or required assumptions."
      : "Keep only if it materially affects the task or output requirements.";
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