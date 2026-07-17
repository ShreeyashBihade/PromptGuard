import * as vscode from "vscode";
import { PromptIssue } from "../types";
const styles: Record<string, vscode.TextEditorDecorationType> = {
  error: vscode.window.createTextEditorDecorationType({ textDecoration: "underline wavy #f14c4c" }),
  warning: vscode.window.createTextEditorDecorationType({ textDecoration: "underline wavy #cca700" }),
  info: vscode.window.createTextEditorDecorationType({ textDecoration: "underline dotted #75beff" })
};
export class IssueDecorations implements vscode.Disposable {
  apply(editor: vscode.TextEditor, issues: PromptIssue[]): void {
    for (const severity of Object.keys(styles)) {
      const options = issues.filter(issue => issue.range && issue.severity === severity).map(issue => ({ range: new vscode.Range(editor.document.positionAt(issue.range!.start), editor.document.positionAt(issue.range!.end)), hoverMessage: new vscode.MarkdownString(`**PromptGuard · ${issue.title}**\n\n${issue.description}\n\n**Suggested fix:** ${issue.suggestedFix}`) }));
      editor.setDecorations(styles[severity]!, options);
    }
  }
  dispose(): void { Object.values(styles).forEach(style => style.dispose()); }
}
