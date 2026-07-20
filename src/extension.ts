import * as vscode from "vscode";
import { PromptAnalyzer } from "./analysis/promptAnalyzer";
import { AssessmentPathMode, getSettings } from "./config/settings";
import { Dashboard } from "./dashboard/dashboard";
import { HistoryStore } from "./history/historyStore";
import { OptimizationLedgerStore } from "./history/optimizationLedger";
import { AnalysisResult } from "./types";
import { PromptOptimizationLedger } from "./types";
import { IssueDecorations } from "./ui/decorations";
import { NavigatorProvider } from "./ui/navigator";
import { PromptGuardCodeActions } from "./commands/registerCodeActions";
import { PromptGuardParticipant } from "./chat/promptGuardParticipant";
import { GroqGateway } from "./integrations/groq/groqGateway";
import { PromptChatPanel } from "./ui/promptChatPanel";
import { OptimizationComparisonPanel } from "./ui/optimizationComparisonPanel";
import { RefinementAction, RefinementService } from "./improver/refinementService";
import { RefinementPanel } from "./ui/refinementPanel";
import { GroqModelProvider } from "./integrations/groq/groqModelProvider";
import { GroqClient } from "./integrations/groq/groqClient";
import { PromptGuardApi } from "./api/promptGuardApi";
import { OnboardingGate } from "./services/onboarding/onboardingGate";
import { PromptTraceLogger } from "./services/tracing/promptTraceLogger";
import { PromptExecutionService } from "./services/pipeline/promptExecutionService";

export function activate(context: vscode.ExtensionContext): void {
  const PATH_MODE_INITIALIZED_KEY = "promptguard.pathModeInitialized";
  const analyzer = new PromptAnalyzer(); const history = new HistoryStore(context.workspaceState);
  const ledger = new OptimizationLedgerStore();
  const groqClient = new GroqClient(context.extensionUri.fsPath); const groq = new GroqGateway(groqClient);
  const refinements = new RefinementService(groq); const api = new PromptGuardApi(context);
  const onboarding = new OnboardingGate(api); const traces = new PromptTraceLogger();
  const decorations = new IssueDecorations(); const navigator = new NavigatorProvider();
  const execution = new PromptExecutionService(analyzer, groq, onboarding, history, ledger, navigator, traces);
  const comparisonPanel = new OptimizationComparisonPanel();
  const syncOnboardingStatus = (): void => { navigator.setOnboardingState(onboarding.currentState()); };
  syncOnboardingStatus();
  let lastResult: AnalysisResult | undefined; let lastCloudPromptId: string | undefined; let lastPromptText: string | undefined; let lastLedger: PromptOptimizationLedger | undefined;

  const setAssessmentPathMode = async (next: AssessmentPathMode): Promise<void> => {
    const c = vscode.workspace.getConfiguration("promptguard");
    const target = vscode.workspace.workspaceFolders?.length ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global;
    await c.update("assessmentPathMode", next, target);
  };

  const chooseModeFromUser = async (placeHolder: string): Promise<AssessmentPathMode | undefined> => {
    const picked = await vscode.window.showQuickPick([
      { label: "Always ask per prompt", description: "Choose Local or Groq each time", mode: "alwaysAsk" as AssessmentPathMode },
      { label: "Prefer local", description: "Use local rating path by default", mode: "preferLocal" as AssessmentPathMode },
      { label: "Prefer Groq", description: "Use Groq-assessed path by default", mode: "preferGroq" as AssessmentPathMode }
    ], { placeHolder });
    return picked?.mode;
  };

  const ensurePathModeInitialized = async (): Promise<void> => {
    if (context.workspaceState.get<boolean>(PATH_MODE_INITIALIZED_KEY, false)) return;
    const selected = await chooseModeFromUser("Choose your default prompt analysis path for this project");
    if (!selected) return;
    await setAssessmentPathMode(selected);
    await context.workspaceState.update(PATH_MODE_INITIALIZED_KEY, true);
    const label = selected === "alwaysAsk" ? "Always ask" : selected === "preferLocal" ? "Prefer local" : "Prefer Groq";
    vscode.window.showInformationMessage(`PromptGuard path mode set to: ${label}. You can change it anytime with /preferences.`);
  };

  const chooseAssessmentPath = async (source: "editor" | "local-chat" | "chat-participant" | "on-save"): Promise<boolean | undefined> => {
    if (source === "on-save") return false;
    await ensurePathModeInitialized();
    const mode = getSettings().assessmentPathMode;
    if (mode === "preferLocal") return false;
    if (mode === "preferGroq") return true;
    const picked = await vscode.window.showQuickPick([
      { label: "Groq-assessed path", description: "Cloud-assisted assessment and optimization", withGroq: true },
      { label: "Local rating path", description: "Runs fully local with local best-practice and model guidance", withGroq: false }
    ], { placeHolder: "Choose analysis path for this prompt" });
    return picked?.withGroq;
  };

  const toggleAssessmentPathMode = async (): Promise<void> => {
    const current = getSettings().assessmentPathMode;
    const next: AssessmentPathMode = current === "alwaysAsk" ? "preferLocal" : current === "preferLocal" ? "preferGroq" : "alwaysAsk";
    await setAssessmentPathMode(next);
    await context.workspaceState.update(PATH_MODE_INITIALIZED_KEY, true);
    const label = next === "alwaysAsk" ? "Always ask" : next === "preferLocal" ? "Prefer local" : "Prefer Groq";
    vscode.window.showInformationMessage(`PromptGuard path mode: ${label}.`);
  };

  const openPreferences = async (): Promise<void> => {
    const selected = await chooseModeFromUser("PromptGuard preferences: choose your default analysis path");
    if (!selected) {
      await vscode.commands.executeCommand("workbench.action.openSettings", "@ext:promptguard");
      return;
    }
    await setAssessmentPathMode(selected);
    await context.workspaceState.update(PATH_MODE_INITIALIZED_KEY, true);
    const label = selected === "alwaysAsk" ? "Always ask" : selected === "preferLocal" ? "Prefer local" : "Prefer Groq";
    vscode.window.showInformationMessage(`PromptGuard preferences updated: ${label}.`);
  };

  const runRefinement = async (action: RefinementAction): Promise<void> => {
    if (!lastResult) { vscode.window.showInformationMessage("Analyze a prompt before choosing a refinement action."); return; }
    if (action !== "cleanup") {
      const authorization = await onboarding.authorizeForGroq();
      syncOnboardingStatus();
      if (!authorization.allowed) {
        const suffix = authorization.httpStatus ? ` (HTTP ${authorization.httpStatus})` : "";
        vscode.window.showWarningMessage(`PromptGuard: ${authorization.reason ?? "Onboarding incomplete."}${suffix} Run \"PromptGuard: Complete Cloud Onboarding\".`);
        return;
      }
    }
    const panel = new RefinementPanel((prompt, selectedAction) => refinements.plan(prompt, selectedAction), async (prompt, answers, selectedAction) => {
      const result = await refinements.run(prompt, answers, selectedAction);
      await onboarding.recordModifiedPrompt(lastCloudPromptId, result.prompt);
      lastLedger = await ledger.record({
        source: selectedAction === "expand" ? "refine-expand" : selectedAction === "minimize" ? "refine-minimize" : "refine-cleanup",
        projectName: vscode.workspace.workspaceFolders?.[0]?.name ?? vscode.workspace.name ?? "workspace",
        inputPrompt: prompt,
        outputPrompt: result.prompt,
        inputTokens: result.sourceTokens,
        outputTokens: result.resultTokens,
        estimatedSavingsUsd: result.costUsd,
        score: lastResult?.score.total
      });
      return result;
    });
    await panel.show(lastResult.prompt, action);
  };

  const logoutUser = async (): Promise<void> => {
    await onboarding.logout();
    execution.clearCaches();
    lastResult = undefined;
    lastCloudPromptId = undefined;
    lastPromptText = undefined;
    syncOnboardingStatus();
    vscode.window.showInformationMessage("PromptGuard: You have been logged out.");
  };

  const deleteUserData = async (): Promise<void> => {
    const choice = await vscode.window.showWarningMessage("Delete PromptGuard account context and local PromptGuard history for this workspace?", { modal: true }, "Delete");
    if (choice !== "Delete") return;
    await onboarding.deleteAccount();
    await history.clear();
    await ledger.clear();
    execution.clearCaches();
    lastResult = undefined;
    lastCloudPromptId = undefined;
    lastPromptText = undefined;
    lastLedger = undefined;
    syncOnboardingStatus();
    vscode.window.showInformationMessage("PromptGuard: account context and local prompt data deleted.");
  };

  const dashboard = new Dashboard(context.extensionUri, action => {
    if (action === "logout") { void logoutUser(); return; }
    if (action === "delete") { void deleteUserData(); return; }
    void runRefinement(action);
  });
  const localChat = new PromptChatPanel(async prompt => {
    const settings = getSettings(); if (prompt.trim().length < settings.minimumPromptLength) { vscode.window.showInformationMessage("PromptGuard: Enter a longer prompt to analyze."); return undefined; }
    const withGroq = await chooseAssessmentPath("local-chat");
    if (withGroq === undefined) return undefined;
    try {
      const outcome = await execution.analyzeAndPersist(prompt, { withGroq, source: "local-chat", disabledRules: settings.disabledRules });
      lastResult = outcome.result; lastCloudPromptId = outcome.cloudPromptId; lastPromptText = prompt; lastLedger = await ledger.snapshot(); dashboard.show(lastResult, history.list(), lastLedger); return lastResult;
    } catch (error) {
      vscode.window.showWarningMessage(`PromptGuard: ${error instanceof Error ? error.message : "Mandatory onboarding is incomplete."}`);
      return undefined;
    } finally {
      syncOnboardingStatus();
    }
  });
  const activeText = (): { editor: vscode.TextEditor; text: string } | undefined => { const editor = vscode.window.activeTextEditor; if (!editor) return undefined; return { editor, text: editor.selection.isEmpty ? editor.document.getText() : editor.document.getText(editor.selection) }; };
  const ensureOnboardingBeforeChat = async (): Promise<boolean> => {
    const authorization = await onboarding.authorizeForGroq();
    syncOnboardingStatus();
    if (!authorization.allowed) {
      vscode.window.showInformationMessage("PromptGuard is running in local analysis mode. Complete cloud onboarding anytime to enable cloud logging and Groq checks.");
    }
    return true;
  };
  const openAnalyzeMode = async (): Promise<void> => {
    await ensureOnboardingBeforeChat();
    const seed = "@promptguard /analyze ";
    try {
      await vscode.commands.executeCommand("workbench.action.chat.open", { query: seed });
      return;
    } catch {
      // Fallback for VS Code versions that do not support object arguments.
    }
    try {
      await vscode.commands.executeCommand("workbench.action.chat.open", seed);
      return;
    } catch {
      // Final fallback: open chat and guide the user.
    }
    await vscode.commands.executeCommand("workbench.action.chat.open");
    vscode.window.showInformationMessage("PromptGuard: In Chat, run @promptguard /analyze and paste your prompt.");
  };
  const completeOnboarding = async (notifySuccess = true): Promise<void> => {
    const authorization = await onboarding.startOnboarding();
    syncOnboardingStatus();
    if (authorization.allowed) {
      if (notifySuccess) {
        vscode.window.showInformationMessage("PromptGuard: Onboarding complete. Analyse Mode can now use cloud logging and Groq checks.");
      }
      return;
    }
    const suffix = authorization.httpStatus ? ` (HTTP ${authorization.httpStatus})` : "";
    vscode.window.showWarningMessage(`PromptGuard onboarding not completed: ${authorization.reason ?? authorization.stage}${suffix}`);
  };
  const resetOnboardingAndCaches = async (): Promise<void> => {
    await onboarding.resetOnboarding();
    execution.clearCaches();
    lastCloudPromptId = undefined;
    syncOnboardingStatus();
    vscode.window.showInformationMessage("PromptGuard: onboarding state and in-memory caches were reset. Start again from Analyse Mode.");
  };
  const showRuntimeInfo = (): void => {
    const version = String((context.extension.packageJSON as { version?: unknown }).version ?? "unknown");
    const apiBaseUrl = vscode.workspace.getConfiguration("promptguard").get<string>("apiBaseUrl", "").trim();
    vscode.window.showInformationMessage(`PromptGuard ${version} | onboarding=${onboarding.currentState()} | apiBaseUrl=${apiBaseUrl || "(empty)"}`);
  };
  const analyze = async (withGroq = true): Promise<void> => {
    const target = activeText(); const settings = getSettings(); if (!target || !settings.enabled) return;
    if (target.text.trim().length < settings.minimumPromptLength) { vscode.window.showInformationMessage("PromptGuard: Select a prompt with more content to analyze."); return; }
    const selected = await chooseAssessmentPath(withGroq ? "editor" : "on-save");
    if (selected === undefined) return;
    try {
      const outcome = await execution.analyzeAndPersist(target.text, { withGroq: selected, source: selected ? "editor" : "on-save", disabledRules: settings.disabledRules });
      lastResult = outcome.result; lastCloudPromptId = outcome.cloudPromptId; lastPromptText = target.text; lastLedger = await ledger.snapshot(); decorations.apply(target.editor, lastResult.issues);
      vscode.window.showInformationMessage(`PromptGuard: ${lastResult.score.total}/100 · ${lastResult.issues.length} finding${lastResult.issues.length === 1 ? "" : "s"}`); dashboard.show(lastResult, history.list(), lastLedger);
    } catch (error) {
      vscode.window.showWarningMessage(`PromptGuard: ${error instanceof Error ? error.message : "Mandatory onboarding is incomplete."}`);
    } finally {
      syncOnboardingStatus();
    }
  };
  const optimize = async (): Promise<void> => {
    if (!lastResult) await analyze();
    if (!lastResult || !lastPromptText) return;
    comparisonPanel.show(lastPromptText, lastResult.optimization.optimizedPrompt);
  };
  const chat = new PromptGuardParticipant(analyzer, getSettings, async (result, entry, withGroq) => {
    try {
      const outcome = await execution.enrichHistoryEntry(result, entry, "chat-participant", withGroq);
      lastResult = outcome.result; lastCloudPromptId = outcome.cloudPromptId; lastPromptText = entry.originalPrompt; lastLedger = await ledger.snapshot();
    } finally {
      syncOnboardingStatus();
    }
  }, async () => chooseAssessmentPath("chat-participant"));
  const participant = vscode.chat.createChatParticipant("promptguard.analyzer", (request, chatContext, stream, token) => chat.handle(request, chatContext, stream, token));
  participant.iconPath = vscode.Uri.joinPath(context.extensionUri, "resources", "promptguard.svg");
  const groqProvider = vscode.lm.registerLanguageModelChatProvider("promptguard-groq", new GroqModelProvider(groqClient));
  context.subscriptions.push(vscode.commands.registerCommand("promptguard.togglePathMode", () => { void toggleAssessmentPathMode(); }));
  context.subscriptions.push(vscode.commands.registerCommand("promptguard.preferences", () => { void openPreferences(); }));
  context.subscriptions.push(vscode.commands.registerCommand("promptguard.settings", () => { void openPreferences(); }));
  context.subscriptions.push(decorations, traces, participant, groqProvider, vscode.window.registerTreeDataProvider("promptguard.navigator", navigator), vscode.languages.registerCodeActionsProvider({ scheme: "file" }, new PromptGuardCodeActions(), { providedCodeActionKinds: PromptGuardCodeActions.providedCodeActionKinds }), vscode.commands.registerCommand("promptguard.analyze", analyze), vscode.commands.registerCommand("promptguard.optimize", optimize), vscode.commands.registerCommand("promptguard.improve", () => runRefinement("expand")), vscode.commands.registerCommand("promptguard.openChat", () => { void openAnalyzeMode(); }), vscode.commands.registerCommand("promptguard.openLocalChat", () => localChat.show()), vscode.commands.registerCommand("promptguard.completeOnboarding", () => { void completeOnboarding(); }), vscode.commands.registerCommand("promptguard.resetOnboarding", () => { void resetOnboardingAndCaches(); }), vscode.commands.registerCommand("promptguard.showRuntimeInfo", showRuntimeInfo), vscode.commands.registerCommand("promptguard.configureGroq", () => vscode.window.showInformationMessage("Create .env from .env.example and add a newly generated GROQ_API_KEY, then reload VS Code.")), vscode.commands.registerCommand("promptguard.logout", () => { void logoutUser(); }), vscode.commands.registerCommand("promptguard.deleteData", () => { void deleteUserData(); }), vscode.commands.registerCommand("promptguard.openDashboard", async () => { lastLedger = await ledger.snapshot(); dashboard.show(lastResult, history.list(), lastLedger); }), vscode.commands.registerCommand("promptguard.showHistory", async () => { const entry = await vscode.window.showQuickPick(history.list().map(item => ({ label: `${item.score}/100 · ${new Date(item.timestamp).toLocaleDateString()}`, description: item.originalPrompt.slice(0, 90), item })), { placeHolder: "Search your local PromptGuard history" }); if (entry) { const doc = await vscode.workspace.openTextDocument({ content: entry.item.originalPrompt, language: "markdown" }); await vscode.window.showTextDocument(doc); } }), vscode.commands.registerCommand("promptguard.openSettings", () => vscode.commands.executeCommand("workbench.action.openSettings", "@ext:promptguard")), vscode.workspace.onDidSaveTextDocument(document => { if (getSettings().analyzeOnSave && vscode.window.activeTextEditor?.document === document) void analyze(false); }));

  void ensurePathModeInitialized();

}
export function deactivate(): void {}
