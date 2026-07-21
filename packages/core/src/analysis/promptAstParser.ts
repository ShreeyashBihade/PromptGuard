import { RuleContext } from "../types";
import { PromptAstDocument, PromptAstNode, PromptAstNodeKind } from "./promptAst";

interface PromptBlock {
  readonly text: string;
  readonly lines: readonly string[];
  readonly lineStart: number;
  readonly lineEnd: number;
}

interface Fingerprint {
  readonly tokens: Set<string>;
}

const SECTION_ALIASES: Readonly<Record<string, PromptAstNodeKind>> = {
  role: "role",
  persona: "role",
  context: "context",
  background: "context",
  task: "task",
  objective: "task",
  goal: "task",
  instructions: "task",
  constraints: "constraints",
  constraint: "constraints",
  examples: "examples",
  example: "examples",
  "output format": "output-format",
  output: "output-format",
  format: "output-format",
  schema: "output-format",
  notes: "notes",
  metadata: "metadata",
  meta: "metadata"
};

const SECTION_ORDER: PromptAstNodeKind[] = ["role", "context", "task", "constraints", "examples", "output-format", "notes", "metadata", "paragraph", "bullet"];

export class PromptAstParser {
  parse(prompt: string): PromptAstDocument {
    const startedAt = Date.now();
    const blocks = this.splitBlocks(prompt);
    const fingerprints: Fingerprint[] = [];
    const children = blocks.map(block => this.buildBlockNode(block, fingerprints));

    const root = this.buildNode("document", prompt.trim(), 1, Math.max(1, prompt.split(/\r?\n/).length), children, fingerprints, this.tokenize(prompt));
    return { ...root, rawText: prompt, lineCount: Math.max(1, prompt.split(/\r?\n/).length), parseMs: Date.now() - startedAt };
  }

  toRuleContext(ast: PromptAstDocument): RuleContext {
    return {
      prompt: ast.rawText,
      words: ast.rawText.match(/[\p{L}\p{N}_'-]+/gu) ?? [],
      sentences: ast.rawText.split(/[.!?]+/).map(sentence => sentence.trim()).filter(Boolean)
    };
  }

  private buildBlockNode(block: PromptBlock, fingerprints: Fingerprint[]): PromptAstNode {
    const kind = this.inferKind(block);
    const children = this.extractChildren(block, fingerprints);
    const text = this.normalizeBlockText(block, kind);
    return this.buildNode(kind, text, block.lineStart, block.lineEnd, children, fingerprints, this.tokenize(text));
  }

  private buildNode(
    kind: PromptAstNodeKind,
    text: string,
    lineStart: number,
    lineEnd: number,
    children: PromptAstNode[],
    fingerprints: Fingerprint[],
    tokens: readonly string[]
  ): PromptAstNode {
    const tokenCount = Math.max(0, tokens.length);
    const ambiguityScore = this.scoreAmbiguity(text);
    const duplicateScore = this.scoreDuplicate(tokens, fingerprints);
    const importance = this.scoreImportance(kind, text, children.length, tokenCount, ambiguityScore, duplicateScore);
    if (kind !== "bullet" && kind !== "paragraph") {
      fingerprints.push({ tokens: new Set(tokens) });
    }
    return { kind, text, tokenCount, importance, ambiguityScore, duplicateScore, lineStart, lineEnd, children };
  }

  private splitBlocks(prompt: string): PromptBlock[] {
    const lines = prompt.split(/\r?\n/);
    const blocks: PromptBlock[] = [];
    let currentStart = -1;
    const currentLines: string[] = [];

    const flush = (endLine: number): void => {
      if (currentLines.length === 0 || currentStart < 0) return;
      blocks.push({ text: currentLines.join("\n"), lines: [...currentLines], lineStart: currentStart + 1, lineEnd: endLine + 1 });
      currentLines.length = 0;
      currentStart = -1;
    };

    lines.forEach((line, index) => {
      if (!line.trim()) {
        flush(index - 1);
        return;
      }
      if (currentStart < 0) currentStart = index;
      currentLines.push(line);
    });

    flush(lines.length - 1);
    return blocks;
  }

  private inferKind(block: PromptBlock): PromptAstNodeKind {
    const first = this.normalizeLabel(this.stripBulletPrefix(block.lines[0] ?? ""));
    const explicit = this.matchSectionLabel(first);
    if (explicit) return explicit;

    const text = block.text.toLowerCase();
    const scores: Array<[PromptAstNodeKind, number]> = [
      ["role", this.roleScore(text)],
      ["context", this.contextScore(text)],
      ["task", this.taskScore(text)],
      ["constraints", this.constraintsScore(text)],
      ["examples", this.examplesScore(text)],
      ["output-format", this.outputFormatScore(text)],
      ["notes", this.notesScore(text)],
      ["metadata", this.metadataScore(block)]
    ];

    const winner = scores.sort((left, right) => right[1] - left[1])[0];
    return winner && winner[1] > 0 ? winner[0] : "context";
  }

  private extractChildren(block: PromptBlock, fingerprints: Fingerprint[]): PromptAstNode[] {
    const bulletLines = block.lines.filter(line => this.isBulletLine(line));
    if (!bulletLines.length) return [];

    return bulletLines.map((line, index) => {
      const text = this.stripBulletPrefix(line).trim();
      const tokens = this.tokenize(text);
      const lineNumber = block.lineStart + block.lines.findIndex(candidate => candidate === line);
      return this.buildNode("bullet", text, lineNumber, lineNumber, [], fingerprints, tokens);
    });
  }

  private normalizeBlockText(block: PromptBlock, kind: PromptAstNodeKind): string {
    const firstLine = block.lines[0] ?? "";
    const explicitLabel = this.normalizeLabel(this.stripBulletPrefix(firstLine));
    if (kind !== "paragraph" && kind !== "bullet" && this.matchSectionLabel(explicitLabel)) {
      const colonIndex = firstLine.indexOf(":");
      if (colonIndex >= 0 && colonIndex < firstLine.length - 1) {
        const remainder = firstLine.slice(colonIndex + 1).trim();
        const tail = block.lines.slice(1).join("\n").trim();
        return [remainder, tail].filter(Boolean).join("\n");
      }
      return block.text.trim();
    }

    return block.text.trim();
  }

  private matchSectionLabel(label: string): PromptAstNodeKind | undefined {
    const normalized = label.replace(/[:\-]+$/g, "").trim();
    if (!normalized) return undefined;
    return SECTION_ALIASES[normalized] ?? undefined;
  }

  private normalizeLabel(text: string): string {
    return text
      .replace(/^#{1,6}\s*/, "")
      .replace(/^[-*+•]\s*/, "")
      .trim()
      .toLowerCase();
  }

  private stripBulletPrefix(line: string): string {
    const trimmed = line.trimStart();
    if (this.isBulletLine(trimmed)) {
      return trimmed.replace(/^[-*+•]\s*/, "").replace(/^\d+[.)]\s*/, "").trim();
    }
    return trimmed;
  }

  private isBulletLine(line: string): boolean {
    const trimmed = line.trimStart();
    if (!trimmed) return false;
    const first = trimmed[0];
    if (first === "-" || first === "*" || first === "+" || first === "•") return true;
    let index = 0;
    while (index < trimmed.length && this.isDigit(trimmed[index])) index += 1;
    return index > 0 && (trimmed[index] === "." || trimmed[index] === ")") && trimmed[index + 1] === " ";
  }

  private roleScore(text: string): number {
    return this.countMatches(text, ["you are", "act as", "as a", "you’re", "expert", "senior", "assistant"])
      + this.countMatches(text, ["role", "persona"])
      + this.countMatches(text, ["write as", "respond as"]);
  }

  private contextScore(text: string): number {
    return this.countMatches(text, ["background", "context", "overview", "setup", "situation", "project", "audience"])
      + this.countMatches(text, ["here is", "the following", "details"]);
  }

  private taskScore(text: string): number {
    return this.countMatches(text, ["write", "create", "draft", "build", "generate", "analyze", "summarize", "design", "explain", "implement", "compare", "validate", "produce", "return", "make", "help", "please"])
      + this.countMatches(text, ["task", "goal", "objective", "request"]);
  }

  private constraintsScore(text: string): number {
    return this.countMatches(text, ["must", "must not", "avoid", "limit", "only", "exactly", "at most", "under", "no more than", "required", "include", "exclude"]);
  }

  private examplesScore(text: string): number {
    return this.countMatches(text, ["example", "examples", "e.g.", "for example", "input", "output", "sample", "like this"]);
  }

  private outputFormatScore(text: string): number {
    return this.countMatches(text, ["json", "markdown", "table", "bullet", "bullets", "schema", "format", "structure", "headings", "list", "yaml", "xml"])
      + (text.includes("return") ? 1 : 0);
  }

  private notesScore(text: string): number {
    return this.countMatches(text, ["note", "notes", "additional", "background note", "remarks"]);
  }

  private metadataScore(block: PromptBlock): number {
    const kvLines = block.lines.filter(line => {
      const trimmed = line.trim();
      if (!trimmed.includes(":")) return false;
      const colonIndex = trimmed.indexOf(":");
      return colonIndex > 0 && colonIndex < trimmed.length - 1 && trimmed.indexOf(" ") > colonIndex;
    });
    return kvLines.length >= 2 ? kvLines.length * 3 : this.countMatches(block.text.toLowerCase(), ["audience", "tone", "language", "model", "length", "temperature"]);
  }

  private scoreImportance(kind: PromptAstNodeKind, text: string, childCount: number, tokenCount: number, ambiguityScore: number, duplicateScore: number): number {
    const base: Record<PromptAstNodeKind, number> = {
      document: 100,
      role: 80,
      context: 55,
      task: 95,
      constraints: 96,
      examples: 60,
      "output-format": 92,
      notes: 40,
      metadata: 52,
      paragraph: 48,
      bullet: 44
    };

    const lengthBonus = Math.min(10, Math.floor(tokenCount / 20));
    const structuralBonus = Math.min(8, childCount * 2);
    const clarityPenalty = Math.min(12, Math.floor(ambiguityScore / 12));
    const duplicatePenalty = Math.min(16, Math.floor(duplicateScore / 8));
    const scopeBonus = text.includes("must") || text.includes("exactly") ? 4 : 0;

    return Math.max(0, Math.min(100, base[kind] + lengthBonus + structuralBonus + scopeBonus - clarityPenalty - duplicatePenalty));
  }

  private scoreAmbiguity(text: string): number {
    const weakTerms = ["nice", "good", "better", "appropriate", "quickly", "some", "things", "etc", "maybe", "maybe", "stuff", "simple", "easy", "helpful", "flexible", "robust", "optimize", "improve"];
    const lower = text.toLowerCase();
    return Math.min(100, weakTerms.reduce((score, term) => score + (lower.includes(term) ? 9 : 0), 0) + this.countMatches(lower, ["perhaps", "usually", "often", "generally", "approximately"]));
  }

  private scoreDuplicate(tokens: readonly string[], fingerprints: Fingerprint[]): number {
    if (!tokens.length || fingerprints.length === 0) return 0;
    const current = new Set(tokens.map(token => token.toLowerCase()));
    let best = 0;
    for (const fingerprint of fingerprints) {
      const similarity = this.jaccardSimilarity(current, fingerprint.tokens);
      if (similarity > best) best = similarity;
    }
    return Math.round(best * 100);
  }

  private jaccardSimilarity(left: Set<string>, right: Set<string>): number {
    if (!left.size || !right.size) return 0;
    let intersection = 0;
    for (const value of left) if (right.has(value)) intersection += 1;
    const union = left.size + right.size - intersection;
    return union === 0 ? 0 : intersection / union;
  }

  private tokenize(text: string): string[] {
    return text.match(/[\p{L}\p{N}_'-]+/gu) ?? [];
  }

  private countMatches(text: string, phrases: readonly string[]): number {
    return phrases.reduce((count, phrase) => count + (text.includes(phrase) ? 1 : 0), 0);
  }

  private isDigit(char: string | undefined): boolean {
    return Boolean(char && char >= "0" && char <= "9");
  }
}
