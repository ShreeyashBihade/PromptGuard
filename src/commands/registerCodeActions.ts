import * as vscode from "vscode";
export class PromptGuardCodeActions implements vscode.CodeActionProvider {
  static readonly providedCodeActionKinds = [vscode.CodeActionKind.QuickFix];
  provideCodeActions(): vscode.CodeAction[] { const action = new vscode.CodeAction("PromptGuard: Preview optimization", vscode.CodeActionKind.QuickFix); action.command = { command: "promptguard.optimize", title: "Preview PromptGuard optimization" }; return [action]; }
}
