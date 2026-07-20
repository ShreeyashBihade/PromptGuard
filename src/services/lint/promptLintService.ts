import * as vscode from "vscode";
import { PromptAnalyzer } from "../../analysis/promptAnalyzer";
import { PromptIssue, Severity } from "../../types";
import { PromptPolicyService } from "../policy/promptPolicyService";

export interface PromptLintResult {
  readonly diagnostics: vscode.Diagnostic[];
  readonly issues: PromptIssue[];
}

export class PromptLintService {
  constructor(private readonly analyzer = new PromptAnalyzer(), private readonly policyService?: PromptPolicyService) {}

  lint(document: vscode.TextDocument, disabledRules: readonly string[] = []): PromptLintResult {
    const prompt = document.getText();
    const issues = this.analyzer.analyze(prompt, [...disabledRules]).issues;
    const policyDiagnostics = this.policyService?.validate(prompt, this.analyzer.analyze(prompt, [...disabledRules])).violations.map(violation => this.toPolicyDiagnostic(document, violation)) ?? [];
    return {
      issues,
      diagnostics: [...issues.map(issue => this.toDiagnostic(document, issue)), ...policyDiagnostics]
    };
  }

  private toDiagnostic(document: vscode.TextDocument, issue: PromptIssue): vscode.Diagnostic {
    const range = this.toRange(document, issue);
    const diagnostic = new vscode.Diagnostic(range, `${issue.title}: ${issue.description}`, this.severity(issue.severity));
    diagnostic.source = "PromptGuard";
    diagnostic.code = issue.ruleId;
    return diagnostic;
  }

  private toRange(document: vscode.TextDocument, issue: PromptIssue): vscode.Range {
    if (issue.range) {
      const start = document.positionAt(issue.range.start);
      const end = document.positionAt(Math.max(issue.range.end, issue.range.start + 1));
      return new vscode.Range(start, end);
    }

    const firstLine = document.lineCount > 0 ? document.lineAt(0) : undefined;
    if (firstLine) {
      return new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, Math.max(1, firstLine.text.length)));
    }

    return new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 0));
  }

  private toPolicyDiagnostic(document: vscode.TextDocument, violation: { ruleId: string; description: string; message: string }): vscode.Diagnostic {
    const range = new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, Math.max(1, document.lineAt(0).text.length || 1)));
    const diagnostic = new vscode.Diagnostic(range, `${violation.description}: ${violation.message}`, vscode.DiagnosticSeverity.Warning);
    diagnostic.source = "PromptGuard";
    diagnostic.code = violation.ruleId;
    return diagnostic;
  }

  private severity(severity: Severity): vscode.DiagnosticSeverity {
    switch (severity) {
      case "error": return vscode.DiagnosticSeverity.Error;
      case "warning": return vscode.DiagnosticSeverity.Warning;
      default: return vscode.DiagnosticSeverity.Information;
    }
  }
}