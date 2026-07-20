import { describe, expect, it, vi } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const vscodeMocks = vi.hoisted(() => {
  class Position {
    constructor(public readonly line: number, public readonly character: number) {}
  }

  class Range {
    constructor(public readonly start: Position, public readonly end: Position) {}
  }

  class Diagnostic {
    code?: string;
    source?: string;
    constructor(public readonly range: Range, public readonly message: string, public readonly severity: string) {}
  }

  class WorkspaceEdit {
    readonly operations: Array<{ kind: string; text: string }> = [];
    insert(_uri: { toString(): string }, _position: Position, text: string): void { this.operations.push({ kind: "insert", text }); }
    replace(_uri: { toString(): string }, _range: Range, text: string): void { this.operations.push({ kind: "replace", text }); }
  }

  class CodeAction {
    diagnostics?: Diagnostic[];
    edit?: WorkspaceEdit;
    command?: { command: string; title: string };
    isPreferred?: boolean;
    constructor(public readonly title: string, public readonly kind: string) {}
  }

  return { Position, Range, Diagnostic, WorkspaceEdit, CodeAction };
});

vi.mock("vscode", () => ({
  Position: vscodeMocks.Position,
  Range: vscodeMocks.Range,
  Diagnostic: vscodeMocks.Diagnostic,
  DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2 },
  WorkspaceEdit: vscodeMocks.WorkspaceEdit,
  CodeAction: vscodeMocks.CodeAction,
  CodeActionKind: { QuickFix: "quickfix" }
}));

import { PromptLintService } from "./promptLintService";
import { PromptGuardCodeActions } from "../../commands/registerCodeActions";
import { PromptPolicyService } from "../policy/promptPolicyService";

const document = (text: string) => ({
  uri: { toString: () => "file:///prompt.md" },
  lineCount: text.split(/\r?\n/).length,
  lineAt: (line: number) => ({ text: text.split(/\r?\n/)[line] ?? "" }),
  positionAt: (offset: number) => new vscodeMocks.Position(0, offset),
  getText: () => text
});

describe("PromptLintService", () => {
  it("maps prompt analysis issues into diagnostics", () => {
    const lint = new PromptLintService();
    const report = lint.lint(document(`
Background: ${"This paragraph is repeated to extend the background and should be shortened. ".repeat(20)}
It is generated and is reviewed by the team.
Example 1: input
Example 2: input
Example 3: input
Example 4: input
  `) as any, []);

    const codes = report.diagnostics.map(diagnostic => String(diagnostic.code));
    expect(codes).toContain("missing-role");
    expect(codes).toContain("missing-task");
    expect(codes).toContain("missing-output-format");
    expect(codes).toContain("missing-constraints");
    expect(codes).toContain("long-context");
    expect(codes).toContain("passive-voice");
    expect(codes).toContain("too-many-examples");
  });

  it("adds diagnostics from workspace prompt policies automatically", () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "promptguard-lint-policy-"));
    fs.writeFileSync(path.join(workspaceRoot, "promptguard.json"), JSON.stringify({
      maxTokens: 10,
      requireOutput: true,
      forbidSecrets: true,
      requireConstraints: true
    }, undefined, 2), "utf8");

    const lint = new PromptLintService(undefined as never, new PromptPolicyService(workspaceRoot));
    const report = lint.lint(document("Write a prompt with an API key: sk-test-12345.") as any, []);

    const codes = report.diagnostics.map(diagnostic => String(diagnostic.code));
    expect(codes).toContain("policy:forbidSecrets");
    expect(codes).toContain("policy:requireOutput");
    expect(codes).toContain("policy:requireConstraints");
  });
});

describe("PromptGuardCodeActions", () => {
  it("creates scaffold, redaction, and optimization quick fixes from diagnostics", () => {
    const provider = new PromptGuardCodeActions();
    const diagnostics = [
      Object.assign(new vscodeMocks.Diagnostic(new vscodeMocks.Range(new vscodeMocks.Position(0, 0), new vscodeMocks.Position(0, 1)), "Missing role", "Warning"), { source: "PromptGuard", code: "missing-role" }),
      Object.assign(new vscodeMocks.Diagnostic(new vscodeMocks.Range(new vscodeMocks.Position(0, 5), new vscodeMocks.Position(0, 12)), "Prompt injection", "Error"), { source: "PromptGuard", code: "prompt-injection" }),
      Object.assign(new vscodeMocks.Diagnostic(new vscodeMocks.Range(new vscodeMocks.Position(0, 13), new vscodeMocks.Position(0, 25)), "Long context", "Information"), { source: "PromptGuard", code: "long-context" }),
      Object.assign(new vscodeMocks.Diagnostic(new vscodeMocks.Range(new vscodeMocks.Position(0, 26), new vscodeMocks.Position(0, 45)), "Budget exceeded", "Warning"), { source: "PromptGuard", code: "budget:maxTokens" })
    ];
    const actions = provider.provideCodeActions(document("prompt text" ) as any, new vscodeMocks.Range(new vscodeMocks.Position(0, 0), new vscodeMocks.Position(0, 1)) as any, { diagnostics } as any);

    expect(actions.map(action => action.title)).toContain("PromptGuard: Insert prompt scaffold");
    expect(actions.map(action => action.title)).toContain("PromptGuard: Remove prompt injection text");
    expect(actions.map(action => action.title)).toContain("PromptGuard: Preview optimization");
    expect(actions.map(action => action.title)).toContain("PromptGuard: Reduce token usage");
    const scaffold = actions.find(action => action.title === "PromptGuard: Insert prompt scaffold") as InstanceType<typeof vscodeMocks.CodeAction> | undefined;
    expect(scaffold?.edit?.operations[0]?.text).toContain("You are a [role].");
  });
});