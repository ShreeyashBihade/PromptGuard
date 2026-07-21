export type PromptAstNodeKind =
  | "document"
  | "role"
  | "context"
  | "task"
  | "constraints"
  | "examples"
  | "output-format"
  | "notes"
  | "metadata"
  | "paragraph"
  | "bullet";

export interface PromptAstNode {
  kind: PromptAstNodeKind;
  text: string;
  tokenCount: number;
  importance: number;
  ambiguityScore: number;
  duplicateScore: number;
  lineStart: number;
  lineEnd: number;
  children: PromptAstNode[];
}

export interface PromptAstDocument extends PromptAstNode {
  rawText: string;
  lineCount: number;
  parseMs: number;
}
