import * as vscode from "vscode";
import { PromptAnalyzer } from "./analysis/promptAnalyzer";
import { getSettings } from "./config/settings";
import { Dashboard } from "./dashboard/dashboard";
import { HistoryStore } from "./history/historyStore";
import { AnalysisResult } from "./types";
import { IssueDecorations } from "./ui/decorations";
import { NavigatorProvider } from "./ui/navigator";
import { PromptGuardCodeActions } from "./commands/registerCodeActions";
import { PromptGuardParticipant } from "./chat/promptGuardParticipant";
import { GroqGateway } from "./integrations/groq/groqGateway";
import { PromptChatPanel } from "./ui/promptChatPanel";
import { RefinementAction, RefinementService } from "./improver/refinementService";
import { RefinementPanel } from "./ui/refinementPanel";
import { GroqModelProvider } from "./integrations/groq/groqModelProvider";
import { GroqClient } from "./integrations/groq/groqClient";
import { PromptGuardApi } from "./api/promptGuardApi";

export function activate(context: vscode.ExtensionContext): void {
  const analyzer = new PromptAnalyzer(); const history = new HistoryStore(context.workspaceState);
  const groqClient = new GroqClient(context.extensionUri.fsPath); const groq = new GroqGateway(groqClient);
  const refinements = new RefinementService(groq); const api = new PromptGuardApi(context);
  const decorations = new IssueDecorations(); const navigator = new NavigatorProvider();
  const judgementCache = new Map<string, { expiresAt: number; score: number; rationale: string; costUsd: number }>();
  let lastResult: AnalysisResult | undefined; let lastCloudPromptId: string | undefined;

  const enrichWithGroqJudgement = async (result: AnalysisResult): Promise<AnalysisResult> => {
    if (!await api.authorizeGroqForwarding()) {
      result.groqStatus = "Groq analysis requires verified email and a project context; score is local-only.";
      return result;
    }
    if (!await groq.isConfigured()) { result.groqStatus = "Groq not configured — score is local-only."; return result; }
    try {
      const cached = judgementCache.get(result.prompt);
      const judgement = cached && cached.expiresAt > Date.now() ? cached : await groq.judge(result.prompt, result.issues.map(issue => `${issue.title}: ${issue.description}`));
      if (!cached || cached.expiresAt <= Date.now()) judgementCache.set(result.prompt, { ...judgement, expiresAt: Date.now() + 30 * 60 * 1000 });
      const total = judgement.score;
      result.score.total = total; result.score.grade = total >= 85 ? "Excellent" : total >= 70 ? "Strong" : total >= 50 ? "Needs work" : "At risk";
      result.scoreSource = "groq"; result.groqStatus = cached && cached.expiresAt > Date.now() ? "Groq semantic judgement applied (cached)." : "Groq semantic judgement applied; local rules remain advisory and safety-focused.";
      result.issues.unshift({ id: "groq-semantic-judgement", ruleId: "groq-semantic-judgement", title: "Groq semantic assessment", description: judgement.rationale, severity: judgement.score < 50 ? "warning" : "info", confidence: 0.9, category: "specificity", suggestedFix: "Address the missing context identified by the semantic assessment.", estimatedTokenSavings: 0, estimatedCostSavings: judgement.costUsd });
    } catch (error) { result.groqStatus = `Groq judgement unavailable — local-only score (${error instanceof Error ? error.message : "unknown error"}).`; }
    return result;
  };
  const saveHistory = async (result: AnalysisResult, prompt: string): Promise<void> => { await history.add({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, timestamp: result.analyzedAt, originalPrompt: prompt, optimizedPrompt: result.optimization.optimizedPrompt, score: result.score.total, improvement: Math.max(0, 100 - result.score.total), estimatedSavings: result.cost.potentialSavingsUsd ?? 0 }); navigator.refresh(); };
  const recordOriginal = async (prompt: string): Promise<void> => { lastCloudPromptId = await api.recordOriginalPrompt(prompt); };
  const runRefinement = async (action: RefinementAction): Promise<void> => {
    if (!lastResult) { vscode.window.showInformationMessage("Analyze a prompt before choosing a refinement action."); return; }
    if (action !== "cleanup" && !await api.authorizeGroqForwarding()) {
      vscode.window.showInformationMessage("Verify your email and select a project context before using Groq.");
      return;
    }
    const panel = new RefinementPanel((prompt, selectedAction) => refinements.plan(prompt, selectedAction), async (prompt, answers, selectedAction) => { const result = await refinements.run(prompt, answers, selectedAction); await api.recordModifiedPrompt(lastCloudPromptId, result.prompt); return result; });
    await panel.show(lastResult.prompt, action);
  };
  const dashboard = new Dashboard(context.extensionUri, action => { void runRefinement(action); });
  const localChat = new PromptChatPanel(async prompt => {
    const settings = getSettings(); if (prompt.trim().length < settings.minimumPromptLength) { vscode.window.showInformationMessage("PromptGuard: Enter a longer prompt to analyze."); return undefined; }
    lastResult = await enrichWithGroqJudgement(analyzer.analyze(prompt, settings.disabledRules)); await recordOriginal(prompt); await saveHistory(lastResult, prompt); dashboard.show(lastResult, history.list()); return lastResult;
  });
  const activeText = (): { editor: vscode.TextEditor; text: string } | undefined => { const editor = vscode.window.activeTextEditor; if (!editor) return undefined; return { editor, text: editor.selection.isEmpty ? editor.document.getText() : editor.document.getText(editor.selection) }; };
  const analyze = async (withGroq = true): Promise<void> => {
    const target = activeText(); const settings = getSettings(); if (!target || !settings.enabled) return;
    if (target.text.trim().length < settings.minimumPromptLength) { vscode.window.showInformationMessage("PromptGuard: Select a prompt with more content to analyze."); return; }
    lastResult = analyzer.analyze(target.text, settings.disabledRules); if (withGroq) lastResult = await enrichWithGroqJudgement(lastResult); else lastResult.groqStatus = "Background save uses local rules only; run Analyze for a Groq judgement.";
    decorations.apply(target.editor, lastResult.issues); await recordOriginal(target.text); await saveHistory(lastResult, target.text);
    vscode.window.showInformationMessage(`PromptGuard: ${lastResult.score.total}/100 · ${lastResult.issues.length} finding${lastResult.issues.length === 1 ? "" : "s"}`); dashboard.show(lastResult, history.list());
  };
  const optimize = async (): Promise<void> => { if (!lastResult) await analyze(); if (!lastResult) return; const original = vscode.window.activeTextEditor?.document.uri; if (!original) return; const optimized = await vscode.workspace.openTextDocument({ content: lastResult.optimization.optimizedPrompt, language: "markdown" }); await vscode.commands.executeCommand("vscode.diff", original, optimized.uri, "PromptGuard: Optimization Preview"); };
  const chat = new PromptGuardParticipant(analyzer, getSettings, async (result, entry) => { lastResult = await enrichWithGroqJudgement(result); entry.score = lastResult.score.total; await recordOriginal(entry.originalPrompt); await history.add(entry); navigator.refresh(); });
  const participant = vscode.chat.createChatParticipant("promptguard.analyzer", (request, chatContext, stream, token) => chat.handle(request, chatContext, stream, token));
  participant.iconPath = vscode.Uri.joinPath(context.extensionUri, "resources", "promptguard.svg");
  const groqProvider = vscode.lm.registerLanguageModelChatProvider("promptguard-groq", new GroqModelProvider(groqClient));
  context.subscriptions.push(decorations, participant, groqProvider, vscode.window.registerTreeDataProvider("promptguard.navigator", navigator), vscode.languages.registerCodeActionsProvider({ scheme: "file" }, new PromptGuardCodeActions(), { providedCodeActionKinds: PromptGuardCodeActions.providedCodeActionKinds }), vscode.commands.registerCommand("promptguard.analyze", analyze), vscode.commands.registerCommand("promptguard.optimize", optimize), vscode.commands.registerCommand("promptguard.improve", () => runRefinement("expand")), vscode.commands.registerCommand("promptguard.openChat", () => localChat.show()), vscode.commands.registerCommand("promptguard.configureGroq", () => vscode.window.showInformationMessage("Create .env from .env.example and add a newly generated GROQ_API_KEY, then reload VS Code.")), vscode.commands.registerCommand("promptguard.openDashboard", () => dashboard.show(lastResult, history.list())), vscode.commands.registerCommand("promptguard.showHistory", async () => { const entry = await vscode.window.showQuickPick(history.list().map(item => ({ label: `${item.score}/100 · ${new Date(item.timestamp).toLocaleDateString()}`, description: item.originalPrompt.slice(0, 90), item })), { placeHolder: "Search your local PromptGuard history" }); if (entry) { const doc = await vscode.workspace.openTextDocument({ content: entry.item.originalPrompt, language: "markdown" }); await vscode.window.showTextDocument(doc); } }), vscode.commands.registerCommand("promptguard.openSettings", () => vscode.commands.executeCommand("workbench.action.openSettings", "@ext:promptguard")), vscode.workspace.onDidSaveTextDocument(document => { if (getSettings().analyzeOnSave && vscode.window.activeTextEditor?.document === document) void analyze(false); }));

}
export function deactivate(): void {}
