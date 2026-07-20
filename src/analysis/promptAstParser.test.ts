import { describe, expect, it } from "vitest";
import { PromptAstParser } from "./promptAstParser";

describe("PromptAstParser", () => {
  it("parses explicit prompt sections into a structured tree", () => {
    const parser = new PromptAstParser();
    const ast = parser.parse(`You are a senior product manager.

## Task
Create a launch checklist.

## Constraints
- Keep it under 250 words
- Include exactly 5 acceptance criteria

## Output Format
Return Markdown.`);

    expect(ast.kind).toBe("document");
    expect(ast.children.map(node => node.kind)).toEqual(["role", "task", "constraints", "output-format"]);
    expect(ast.children[0]?.lineStart).toBe(1);
    expect(ast.children[1]?.children.length).toBe(0);
    expect(ast.children[2]?.children.map(node => node.kind)).toEqual(["bullet", "bullet"]);
    expect(ast.children[2]?.children[0]?.lineStart).toBe(7);
    expect(ast.tokenCount).toBeGreaterThan(0);
    expect(ast.parseMs).toBeGreaterThanOrEqual(0);
  });

  it("infers sections without headings and scores duplicates and ambiguity", () => {
    const parser = new PromptAstParser();
    const ast = parser.parse(`You are an expert editor.

Please make it nice and quick.

Please make it nice and quick.`);

    expect(ast.children[0]?.kind).toBe("role");
    expect(ast.children[1]?.kind).toBe("task");
    expect(ast.children[2]?.duplicateScore).toBeGreaterThan(0);
    expect(ast.children[1]?.ambiguityScore).toBeGreaterThan(0);
  });

  it("keeps rule context compatibility for existing analyzers", () => {
    const parser = new PromptAstParser();
    const ast = parser.parse("Write a JSON checklist. Must include role, task, and output format.");
    const context = parser.toRuleContext(ast);

    expect(context.prompt).toContain("JSON checklist");
    expect(context.words.length).toBeGreaterThan(0);
    expect(context.sentences.length).toBeGreaterThan(0);
  });
});
