import * as vscode from "vscode";
export class PromptGuardCodeActions implements vscode.CodeActionProvider {
  static readonly providedCodeActionKinds = [vscode.CodeActionKind.QuickFix];

  provideCodeActions(document: vscode.TextDocument, _range: vscode.Range, context: vscode.CodeActionContext): vscode.CodeAction[] {
    const promptguardDiagnostics = context.diagnostics.filter(diagnostic => diagnostic.source === "PromptGuard");
    if (!promptguardDiagnostics.length) {
      return [];
    }

    const actions: vscode.CodeAction[] = [];
    const scaffold = this.buildScaffoldAction(document, promptguardDiagnostics);
    if (scaffold) {
      actions.push(scaffold);
    }

    for (const diagnostic of promptguardDiagnostics) {
      const action = this.actionForDiagnostic(document, diagnostic);
      if (action) {
        actions.push(action);
      }
    }

    const preview = new vscode.CodeAction("PromptGuard: Preview optimization", vscode.CodeActionKind.QuickFix);
    preview.command = { command: "promptguard.optimize", title: "Preview PromptGuard optimization" };
    actions.push(preview);
    return actions;
  }

  private buildScaffoldAction(document: vscode.TextDocument, diagnostics: readonly vscode.Diagnostic[]): vscode.CodeAction | undefined {
    const needsRole = this.hasDiagnostic(diagnostics, "missing-role");
    const needsTask = this.hasDiagnostic(diagnostics, "missing-task");
    const needsOutput = this.hasDiagnostic(diagnostics, "missing-output-format");
    const needsConstraints = this.hasDiagnostic(diagnostics, "missing-constraints");
    const needsExamples = this.hasDiagnostic(diagnostics, "missing-examples");

    if (!needsRole && !needsTask && !needsOutput && !needsConstraints && !needsExamples) {
      return undefined;
    }

    const lines = [
      needsRole ? "You are a [role]." : undefined,
      needsTask ? "Task: [describe the task]." : undefined,
      needsConstraints ? "Constraints: [length, tone, scope, exclusions]." : undefined,
      needsOutput ? "Output format: [Markdown, bullets, table, JSON, etc.]." : undefined,
      needsExamples ? "Examples:\n- Input: ...\n  Output: ..." : undefined
    ].filter((line): line is string => Boolean(line));

    const edit = new vscode.WorkspaceEdit();
    const prefix = document.lineCount > 0 && document.lineAt(0).text.trim().length > 0 ? "\n" : "";
    edit.insert(document.uri, new vscode.Position(0, 0), `${lines.join("\n")}${prefix}`);

    const action = new vscode.CodeAction("PromptGuard: Insert prompt scaffold", vscode.CodeActionKind.QuickFix);
    action.edit = edit;
    action.diagnostics = diagnostics.filter(diagnostic => ["missing-role", "missing-task", "missing-output-format", "missing-constraints", "missing-examples"].includes(String(diagnostic.code ?? "")));
    action.isPreferred = true;
    return action;
  }

  private actionForDiagnostic(document: vscode.TextDocument, diagnostic: vscode.Diagnostic): vscode.CodeAction | undefined {
    const code = String(diagnostic.code ?? "");
    if (code === "prompt-injection") {
      return this.replaceRangeAction(document, diagnostic, "PromptGuard: Remove prompt injection text", "[instruction removed]");
    }
    if (code === "secret-leakage") {
      return this.replaceRangeAction(document, diagnostic, "PromptGuard: Redact secret", "[REDACTED]");
    }
    if (code === "pii-detection") {
      return this.replaceRangeAction(document, diagnostic, "PromptGuard: Redact PII", "[REDACTED]");
    }
    if (code.startsWith("budget:")) {
      return this.budgetAction(diagnostic, code);
    }
    return undefined;
  }

  private budgetAction(diagnostic: vscode.Diagnostic, code: string): vscode.CodeAction | undefined {
    const title = code === "budget:maxLatencyMs"
      ? "PromptGuard: Reduce latency"
      : code === "budget:maxOutputCostUsd"
        ? "PromptGuard: Reduce output cost"
        : code === "budget:maxInputCostUsd"
          ? "PromptGuard: Reduce input cost"
          : "PromptGuard: Reduce token usage";

    const command = "promptguard.optimize";

    const action = new vscode.CodeAction(title, vscode.CodeActionKind.QuickFix);
    action.command = { command, title };
    action.diagnostics = [diagnostic];
    action.isPreferred = true;
    return action;
  }

  private replaceRangeAction(document: vscode.TextDocument, diagnostic: vscode.Diagnostic, title: string, replacement: string): vscode.CodeAction | undefined {
    if (!diagnostic.range) {
      return undefined;
    }

    const edit = new vscode.WorkspaceEdit();
    edit.replace(document.uri, diagnostic.range, replacement);
    const action = new vscode.CodeAction(title, vscode.CodeActionKind.QuickFix);
    action.edit = edit;
    action.diagnostics = [diagnostic];
    action.isPreferred = true;
    return action;
  }

  private hasDiagnostic(diagnostics: readonly vscode.Diagnostic[], code: string): boolean {
    return diagnostics.some(diagnostic => String(diagnostic.code ?? "") === code);
  }
}
