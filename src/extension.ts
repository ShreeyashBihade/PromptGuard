import * as vscode from "vscode";
import { PromptAnalyzer } from "./analysis/promptAnalyzer";
import { CostEstimator } from "./cost/costEstimator";
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
import { PromptPolicyService } from "./services/policy/promptPolicyService";
import { PromptPolicyPackService } from "./services/policy/promptPolicyPackService";
import { PromptBudgetService } from "./services/budget/promptBudgetService";
import { PromptTemplateService } from "./services/templates/promptTemplateService";
import { PromptTemplateWorkbenchService } from "./services/templates/promptTemplateWorkbenchService";
import { PromptLearningService } from "./services/learning/promptLearningService";
import { PromptBenchmarkService } from "./services/benchmarks/promptBenchmarkService";
import { PromptAuditExportService } from "./services/audit/promptAuditExportService";
import { PromptProviderCatalogService } from "./services/providers/promptProviderCatalogService";
import { PromptProviderRegistryService } from "./services/providers/promptProviderRegistryService";
import { PromptHandoffService } from "./services/handoff/promptHandoffService";
import { PromptLintService } from "./services/lint/promptLintService";
import { PromptDuplicateDetectionService } from "./services/duplicates/promptDuplicateDetectionService";
import { DuplicateDetectionPanel } from "./ui/duplicateDetectionPanel";
import { PromptGuardSettingsPanel } from "./ui/settingsPanel";
import { TemplateWorkbenchPanel } from "./ui/templateWorkbenchPanel";

export function activate(context: vscode.ExtensionContext): void {
  const PATH_MODE_INITIALIZED_KEY = "promptguard.pathModeInitialized";
  const analyzer = new PromptAnalyzer(); const history = new HistoryStore(context.workspaceState);
  const ledger = new OptimizationLedgerStore();
  const groqClient = new GroqClient(context.workspaceState); const groq = new GroqGateway(groqClient);
  const refinements = new RefinementService(groq); const api = new PromptGuardApi(context);
  const onboarding = new OnboardingGate(api); const traces = new PromptTraceLogger();
  const decorations = new IssueDecorations(); const navigator = new NavigatorProvider();
  const policyService = new PromptPolicyService(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath);
  const policyPackService = new PromptPolicyPackService(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath);
  const budgetService = new PromptBudgetService(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath);
  const templateService = new PromptTemplateService(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath, context.globalStorageUri.fsPath);
  const templateWorkbenchService = new PromptTemplateWorkbenchService(templateService);
  const templateWorkbenchPanel = new TemplateWorkbenchPanel();
  const learningService = new PromptLearningService(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath);
  const execution = new PromptExecutionService(analyzer, groq, onboarding, history, ledger, navigator, traces, learningService);
  const comparisonPanel = new OptimizationComparisonPanel(accepted => {
    if (!getSettings().enableLearningStore || !lastResult || !lastPromptText) {
      return;
    }

    const originalEstimate = new CostEstimator().estimate(lastPromptText, lastResult.issues);
    const optimizedEstimate = accepted ? new CostEstimator().estimate(lastResult.optimization.optimizedPrompt, lastResult.issues) : originalEstimate;
    const tokenSavings = accepted ? Math.max(0, lastResult.optimization.estimatedTokenSavings ?? 0) : 0;
    const timeSavedMs = accepted ? Math.max(0, originalEstimate.estimatedLatencyMs - optimizedEstimate.estimatedLatencyMs) : 0;
    learningService.recordOptimization("optimize", lastResult.issues, tokenSavings, timeSavedMs, accepted ? "accepted" : "rejected");
  });
  const benchmarkService = new PromptBenchmarkService(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath);
  const auditExportService = new PromptAuditExportService();
  const providerCatalogService = new PromptProviderCatalogService(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath);
  const providerRegistryService = new PromptProviderRegistryService(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath);
  const handoffService = new PromptHandoffService();
  const duplicateDetectionService = new PromptDuplicateDetectionService();
  const duplicateDetectionPanel = new DuplicateDetectionPanel();
  const settingsPanel = new PromptGuardSettingsPanel({
    onSave: async update => {
      const configuration = vscode.workspace.getConfiguration("promptguard");
      const target = vscode.workspace.workspaceFolders?.length ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global;
      await configuration.update("enabled", update.enabled, target);
      await configuration.update("analyzeOnSave", update.analyzeOnSave, target);
      await configuration.update("minimumPromptLength", update.minimumPromptLength, target);
      await configuration.update("assessmentPathMode", update.assessmentPathMode, target);
      await configuration.update("groqKeyMode", update.groqKeyMode, target);
      await configuration.update("enableBudgetMode", update.enableBudgetMode, target);
      await configuration.update("enableLearningStore", update.enableLearningStore, target);
      await context.workspaceState.update(PATH_MODE_INITIALIZED_KEY, true);
    },
    onOpenAdvanced: async () => {
      await vscode.commands.executeCommand("workbench.action.openSettings", "@ext:promptguard");
    },
    onRefreshState: () => {
      const settings = getSettings();
      return {
        enabled: settings.enabled,
        analyzeOnSave: settings.analyzeOnSave,
        minimumPromptLength: settings.minimumPromptLength,
        assessmentPathMode: settings.assessmentPathMode,
        groqKeyMode: settings.groqKeyMode,
        enableBudgetMode: settings.enableBudgetMode,
        enableLearningStore: settings.enableLearningStore
      };
    }
  });
  const lintService = new PromptLintService(analyzer, policyService);
  const lintDiagnostics = vscode.languages.createDiagnosticCollection("promptguard");
  const syncOnboardingStatus = (): void => { navigator.setOnboardingState(onboarding.currentState()); };
  syncOnboardingStatus();
  let lastResult: AnalysisResult | undefined; let lastCloudPromptId: string | undefined; let lastPromptText: string | undefined; let lastLedger: PromptOptimizationLedger | undefined;

  const refreshDiagnostics = (document: vscode.TextDocument): void => {
    if (document.uri.scheme !== "file" && document.uri.scheme !== "untitled") {
      return;
    }

    const settings = getSettings();
    if (!settings.enabled) {
      lintDiagnostics.delete(document.uri);
      return;
    }

    const diagnostics: vscode.Diagnostic[] = [];
    const lintReport = lintService.lint(document, settings.disabledRules);
    diagnostics.push(...lintReport.diagnostics);

    if (settings.enableBudgetMode) {
      const budgetReport = budgetService.validate(document.getText(), settings.liveTokenPricing);
      if (budgetReport.loaded) {
        diagnostics.push(...budgetReport.violations.map(violation => {
          const diagnostic = new vscode.Diagnostic(getWholeDocumentRange(document), `${violation.message} Suggested fix: ${violation.suggestedFix}`, vscode.DiagnosticSeverity.Warning);
          diagnostic.source = "PromptGuard";
          diagnostic.code = `budget:${violation.field}`;
          return diagnostic;
        }));
      }
    }

    lintDiagnostics.set(document.uri, diagnostics);
  };

  const getWholeDocumentRange = (document: vscode.TextDocument): vscode.Range => {
    if (document.lineCount <= 0) {
      return new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 0));
    }
    const lastLine = document.lineAt(document.lineCount - 1);
    return new vscode.Range(new vscode.Position(0, 0), new vscode.Position(document.lineCount - 1, Math.max(1, lastLine.text.length)));
  };

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
      { label: "Groq-assessed path", description: "Cloud-assisted scoring with local optimization", withGroq: true },
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
    const settings = getSettings();
    settingsPanel.show({
      enabled: settings.enabled,
      analyzeOnSave: settings.analyzeOnSave,
      minimumPromptLength: settings.minimumPromptLength,
      assessmentPathMode: settings.assessmentPathMode,
      groqKeyMode: settings.groqKeyMode,
      enableBudgetMode: settings.enableBudgetMode,
      enableLearningStore: settings.enableLearningStore
    });
  };

  const validatePolicy = async (): Promise<void> => {
    const promptText = await resolvePromptText({
      selectionFallbackPlaceholder: "No active prompt found. Choose policy validation input.",
      inputTitle: "PromptGuard Policy Validation",
      inputPrompt: "Paste prompt text to validate against workspace policy"
    });
    if (!promptText) {
      return;
    }

    const report = policyService.validate(promptText);
    if (!report.loaded) {
      vscode.window.showInformationMessage("PromptGuard: no promptguard.json policy file found in the workspace root.");
      return;
    }

    if (!report.violations.length) {
      vscode.window.showInformationMessage(`PromptGuard policy check passed: ${report.ruleCount} rule${report.ruleCount === 1 ? "" : "s"} validated.`);
      return;
    }

    const summary = report.violations.slice(0, 3).map(violation => `${violation.ruleId}: ${violation.message}`).join(" | ");
    vscode.window.showWarningMessage(`PromptGuard policy violations: ${summary}${report.violations.length > 3 ? " ..." : ""}`);
  };

  const validateBudget = async (): Promise<void> => {
    const promptText = await resolvePromptText({
      selectionFallbackPlaceholder: "No active prompt found. Choose budget validation input.",
      inputTitle: "PromptGuard Budget Validation",
      inputPrompt: "Paste prompt text to validate against workspace budget"
    });
    if (!promptText) {
      return;
    }

    const settings = getSettings();
    const report = budgetService.validate(promptText, settings.liveTokenPricing);
    if (!report.loaded) {
      vscode.window.showInformationMessage("PromptGuard: no promptguard.budget.json file found in the workspace root.");
      return;
    }

    if (!report.violations.length) {
      vscode.window.showInformationMessage(`PromptGuard budget check passed: ${report.profile.totalTokens} tokens within budget.`);
      return;
    }

    const summary = report.violations.slice(0, 3).map(violation => `${violation.message} Fix: ${violation.suggestedFix}`).join(" | ");
    vscode.window.showWarningMessage(`PromptGuard budget violations: ${summary}${report.violations.length > 3 ? " ..." : ""}`);
  };

  const browsePolicyPacks = async (): Promise<void> => {
    const markdown = policyPackService.renderMarkdown();
    const document = await vscode.workspace.openTextDocument({ content: markdown, language: "markdown" });
    await vscode.window.showTextDocument(document, { preview: false });
  };

  const exportPromptHandoff = async (): Promise<void> => {
    const promptText = await resolvePromptText({
      selectionFallbackPlaceholder: "No active prompt found. Choose handoff input.",
      inputTitle: "PromptGuard Export Handoff",
      inputPrompt: "Paste prompt text to export browser or JetBrains handoff"
    });
    if (!promptText) {
      return;
    }

    const picked = await vscode.window.showQuickPick([
      { label: "Browser handoff", description: "Create HTML + JSON artifacts for a future browser extension", target: "browser" as const },
      { label: "JetBrains handoff", description: "Create HTML + JSON artifacts for a future JetBrains plugin", target: "jetbrains" as const }
    ], { placeHolder: "Choose a handoff target" });

    if (!picked) {
      return;
    }

    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const report = await handoffService.export(workspaceRoot, {
      generatedAt: new Date().toISOString(),
      title: `PromptGuard ${picked.target} handoff`,
      prompt: promptText,
      source: vscode.workspace.workspaceFolders?.[0]?.name ?? vscode.workspace.name ?? "workspace",
      target: picked.target
    });

    if (!report) {
      vscode.window.showInformationMessage("PromptGuard: open a workspace folder to export handoff artifacts.");
      return;
    }

    const document = await vscode.workspace.openTextDocument({ content: handoffService.renderHtml(report.artifact), language: "html" });
    await vscode.window.showTextDocument(document, { preview: false });
    vscode.window.showInformationMessage(`PromptGuard handoff exported to ${report.jsonPath} and ${report.htmlPath}.`);
  };

  const browseTemplates = async (): Promise<void> => {
    const target = activeText();
    const report = templateWorkbenchService.review(target?.text ?? "", history.list());
    templateWorkbenchPanel.show(report);
  };

  const insertTemplateSnippet = async (): Promise<void> => {
    const templates = templateService.listTemplates();
    if (!templates.length) {
      vscode.window.showInformationMessage("PromptGuard: no prompt templates were found in workspace, team, or global storage.");
      return;
    }

    const picked = await vscode.window.showQuickPick(
      templates.map(template => ({ label: template.name, description: `${template.scope} · ${template.description}`, template })),
      { placeHolder: "Choose a prompt template to insert" }
    );
    if (!picked) {
      return;
    }

    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      const document = await vscode.workspace.openTextDocument({ content: templateService.getTemplateContent(picked.template), language: "markdown" });
      await vscode.window.showTextDocument(document, { preview: false });
      return;
    }

    const snippet = new vscode.SnippetString(templateService.buildSnippetBody(picked.template));
    await editor.insertSnippet(snippet);
    if (getSettings().enableLearningStore) {
      learningService.recordTemplate(picked.template.tags ?? []);
    }
  };

  const createReusableTemplate = async (): Promise<void> => {
    const promptText = await resolvePromptText({
      selectionFallbackPlaceholder: "No active prompt found. Choose reusable template input.",
      inputTitle: "PromptGuard Reusable Template",
      inputPrompt: "Paste prompt text to generate a reusable template"
    });
    if (!promptText) {
      return;
    }

    const report = templateWorkbenchService.review(promptText, history.list());
    const suggestion = report.prefixSuggestions[0];
    if (!suggestion) {
      vscode.window.showInformationMessage("PromptGuard: no repeated prefix was detected to convert into a reusable template.");
      return;
    }

    const document = await vscode.workspace.openTextDocument({ content: templateWorkbenchService.buildReusableTemplate(suggestion), language: "markdown" });
    await vscode.window.showTextDocument(document, { preview: false });
  };

  const runBenchmarks = async (): Promise<void> => {
    const report = benchmarkService.run();
    if (!report.loaded) {
      vscode.window.showInformationMessage("PromptGuard: no promptguard.benchmarks.json file found in the workspace root.");
      return;
    }

    const lines = [
      `# PromptGuard Benchmark Report`,
      ``,
      `- Suites: ${report.suiteCount}`,
      `- Cases: ${report.caseCount}`,
      `- Passed: ${report.passedCount}`,
      `- Failed: ${report.failedCount}`,
      `- Average score: ${report.averageScore?.toFixed(1) ?? "n/a"}`,
      ``
    ];

    for (const suite of report.suites) {
      lines.push(`## ${suite.suiteName}`);
      if (suite.description) {
        lines.push(suite.description);
      }
      lines.push(`- Cases: ${suite.caseCount} | Passed: ${suite.passedCount} | Failed: ${suite.failedCount}`);
      lines.push(`- Average score: ${suite.averageScore?.toFixed(1) ?? "n/a"}`);
      for (const testCase of suite.cases) {
        lines.push(`  - ${testCase.passed ? "PASS" : "FAIL"}: ${testCase.caseName} (${testCase.score}/100, ${testCase.issueCount} issues, ${testCase.tokenSavings} token savings)`);
        for (const failure of testCase.failures) {
          lines.push(`    - ${failure}`);
        }
      }
      lines.push("");
    }

    const document = await vscode.workspace.openTextDocument({ content: lines.join("\n"), language: "markdown" });
    await vscode.window.showTextDocument(document, { preview: false });
  };

  const exportAuditReport = async (): Promise<void> => {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const report = auditExportService.build({
      workspaceName: vscode.workspace.workspaceFolders?.[0]?.name ?? vscode.workspace.name ?? "workspace",
      history: history.list(),
      ledger: await ledger.snapshot(),
      policy: policyService.load(),
      budget: budgetService.load(),
      templateCount: templateService.listTemplates().length,
      learning: learningService.summarize(),
      benchmarks: benchmarkService.run()
    });
    const markdown = auditExportService.renderMarkdown(report);
    const savedPath = await auditExportService.save(workspaceRoot, report);
    const document = await vscode.workspace.openTextDocument({ content: markdown, language: "markdown" });
    await vscode.window.showTextDocument(document, { preview: false });
    if (savedPath) {
      vscode.window.showInformationMessage(`PromptGuard audit report exported to ${savedPath}.`);
    } else {
      vscode.window.showInformationMessage("PromptGuard audit report generated in the editor.");
    }
  };

  const browseProviders = async (): Promise<void> => {
    const target = activeText();
    const markdown = providerCatalogService.renderMarkdown(target?.text ?? "");
    const document = await vscode.workspace.openTextDocument({ content: markdown, language: "markdown" });
    await vscode.window.showTextDocument(document, { preview: false });
  };

  const manageProviderOptIn = async (): Promise<void> => {
    const picked = await vscode.window.showQuickPick([
      { label: "OpenAI", id: "openai" as const },
      { label: "Claude", id: "claude" as const },
      { label: "Gemini", id: "gemini" as const }
    ], { placeHolder: "Choose a provider to opt in or out" });

    if (!picked) {
      return;
    }

    const action = await vscode.window.showQuickPick([
      { label: "Enable", enabled: true },
      { label: "Disable", enabled: false }
    ], { placeHolder: `Set ${picked.label} opt-in state` });

    if (!action) {
      return;
    }

    await providerRegistryService.setEnabled(picked.id, action.enabled);
    vscode.window.showInformationMessage(`PromptGuard: ${picked.label} has been ${action.enabled ? "enabled" : "disabled"} in promptguard.providers.json.`);
  };

  const runRefinement = async (action: RefinementAction): Promise<void> => {
    if (!lastResult) { vscode.window.showInformationMessage("Analyze a prompt before choosing a refinement action."); return; }
    if (action === "expand") {
      const authorization = await onboarding.authorizeForGroq();
      syncOnboardingStatus();
      if (!authorization.allowed) {
        const suffix = authorization.httpStatus ? ` (HTTP ${authorization.httpStatus})` : "";
        vscode.window.showWarningMessage(`PromptGuard: ${authorization.reason ?? "Onboarding incomplete."}${suffix} Run \"PromptGuard: Complete Cloud Onboarding\".`);
        return;
      }
      if (!await groq.isConfigured()) {
        vscode.window.showWarningMessage("PromptGuard: GROQ_API_KEY unavailable under current key mode. Expand requires Groq credentials in the selected project folder.");
        return;
      }
    }
    const panel = new RefinementPanel((prompt, selectedAction) => refinements.plan(prompt, selectedAction), async (prompt, answers, selectedAction) => {
      const result = await refinements.run(prompt, answers, selectedAction);
      if (getSettings().enableLearningStore) {
        learningService.recordOptimization(
          selectedAction === "expand" ? "refine-expand" : selectedAction === "minimize" ? "refine-minimize" : "refine-cleanup",
          lastResult?.issues ?? [],
          Math.max(0, result.sourceTokens - result.resultTokens),
          Math.max(0, Math.round((result.sourceTokens - result.resultTokens) * 1.7)),
          "accepted"
        );
      }
      if (selectedAction === "expand") {
        await onboarding.recordModifiedPrompt(lastCloudPromptId, result.prompt);
      }
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
    if (action === "switch-project") {
      void (async () => {
        try {
          await onboarding.chooseProject(false);
          syncOnboardingStatus();
          vscode.window.showInformationMessage("PromptGuard: Project switched.");
          lastLedger = await ledger.snapshot();
          dashboard.show(lastResult, history.list(), lastLedger);
        } catch (error) {
          vscode.window.showWarningMessage(`PromptGuard: ${error instanceof Error ? error.message : "Unable to switch project."}`);
        }
      })();
      return;
    }
    if (action === "new-project") {
      void (async () => {
        try {
          await onboarding.chooseProject(true);
          syncOnboardingStatus();
          vscode.window.showInformationMessage("PromptGuard: New project created and selected.");
          lastLedger = await ledger.snapshot();
          dashboard.show(lastResult, history.list(), lastLedger);
        } catch (error) {
          vscode.window.showWarningMessage(`PromptGuard: ${error instanceof Error ? error.message : "Unable to create a new project."}`);
        }
      })();
      return;
    }
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
  const resolvePromptText = async (options: {
    readonly selectionFallbackPlaceholder: string;
    readonly inputTitle: string;
    readonly inputPrompt: string;
  }): Promise<string | undefined> => {
    const target = activeText();
    let promptText = target?.text?.trim().length ? target.text : undefined;

    if (!promptText && lastPromptText?.trim().length) {
      const choice = await vscode.window.showQuickPick([
        { label: "Use last analyzed prompt", mode: "last" as const },
        { label: "Paste prompt text", mode: "paste" as const }
      ], { placeHolder: options.selectionFallbackPlaceholder });

      if (!choice) {
        return undefined;
      }

      if (choice.mode === "last") {
        promptText = lastPromptText;
      }
    }

    if (!promptText) {
      const pasted = await vscode.window.showInputBox({
        title: options.inputTitle,
        prompt: options.inputPrompt,
        placeHolder: "Enter or paste prompt text",
        ignoreFocusOut: true,
        validateInput: value => value.trim().length ? undefined : "Prompt text is required."
      });
      if (!pasted?.trim().length) {
        return undefined;
      }
      promptText = pasted;
    }

    return promptText;
  };
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
  const showRuntimeInfo = async (): Promise<void> => {
    const version = String((context.extension.packageJSON as { version?: unknown }).version ?? "unknown");
    const apiBaseUrl = vscode.workspace.getConfiguration("promptguard").get<string>("apiBaseUrl", "").trim();
    const keyStatus = await groqClient.keyStatus();
    vscode.window.showInformationMessage(`PromptGuard ${version} | onboarding=${onboarding.currentState()} | apiBaseUrl=${apiBaseUrl || "(empty)"} | groqKeyMode=${keyStatus.mode} | groqKeySource=${keyStatus.source}`);
  };
  const openDuplicateDetection = async (): Promise<void> => {
    const promptText = await resolvePromptText({
      selectionFallbackPlaceholder: "No active prompt found. Choose duplicate detection input.",
      inputTitle: "PromptGuard Duplicate Detection",
      inputPrompt: "Paste prompt text to detect duplicate ideas"
    });
    if (!promptText) {
      return;
    }

    duplicateDetectionPanel.show(duplicateDetectionService.detect(promptText));
  };
  const analyze = async (withGroq = true): Promise<void> => {
    const target = activeText(); const settings = getSettings(); if (!target || !settings.enabled) return;
    if (target.text.trim().length < settings.minimumPromptLength) { vscode.window.showInformationMessage("PromptGuard: Select a prompt with more content to analyze."); return; }
    const selected = await chooseAssessmentPath(withGroq ? "editor" : "on-save");
    if (selected === undefined) return;
    try {
      const outcome = await execution.analyzeAndPersist(target.text, { withGroq: selected, source: selected ? "editor" : "on-save", disabledRules: settings.disabledRules });
      lastResult = outcome.result; lastCloudPromptId = outcome.cloudPromptId; lastPromptText = target.text; lastLedger = await ledger.snapshot(); decorations.apply(target.editor, lastResult.issues);
      if (settings.enableLearningStore) {
        learningService.recordAnalyze(outcome.result);
      }
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
    comparisonPanel.show(lastPromptText, lastResult.optimization);
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
  context.subscriptions.push(vscode.commands.registerCommand("promptguard.validatePolicy", () => { void validatePolicy(); }));
  context.subscriptions.push(vscode.commands.registerCommand("promptguard.browsePolicyPacks", () => { void browsePolicyPacks(); }));
  context.subscriptions.push(decorations, traces, participant, groqProvider, vscode.window.registerTreeDataProvider("promptguard.navigator", navigator), vscode.languages.registerCodeActionsProvider({ scheme: "file" }, new PromptGuardCodeActions(), { providedCodeActionKinds: PromptGuardCodeActions.providedCodeActionKinds }), vscode.commands.registerCommand("promptguard.analyze", analyze), vscode.commands.registerCommand("promptguard.optimize", optimize), vscode.commands.registerCommand("promptguard.improve", () => runRefinement("expand")), vscode.commands.registerCommand("promptguard.openChat", () => { void openAnalyzeMode(); }), vscode.commands.registerCommand("promptguard.openLocalChat", () => localChat.show()), vscode.commands.registerCommand("promptguard.completeOnboarding", () => { void completeOnboarding(); }), vscode.commands.registerCommand("promptguard.resetOnboarding", () => { void resetOnboardingAndCaches(); }), vscode.commands.registerCommand("promptguard.showRuntimeInfo", () => { void showRuntimeInfo(); }), vscode.commands.registerCommand("promptguard.configureGroq", () => vscode.window.showInformationMessage("Add GROQ_API_KEY to the selected project folder .env. In strictProjectOnly mode, no fallback key sources are used.")), vscode.commands.registerCommand("promptguard.logout", () => { void logoutUser(); }), vscode.commands.registerCommand("promptguard.deleteData", () => { void deleteUserData(); }), vscode.commands.registerCommand("promptguard.openDashboard", async () => { lastLedger = await ledger.snapshot(); dashboard.show(lastResult, history.list(), lastLedger); }), vscode.commands.registerCommand("promptguard.showHistory", async () => { const entry = await vscode.window.showQuickPick(history.list().map(item => ({ label: `${item.score}/100 · ${new Date(item.timestamp).toLocaleDateString()}`, description: item.originalPrompt.slice(0, 90), item })), { placeHolder: "Search your local PromptGuard history" }); if (entry) { const doc = await vscode.workspace.openTextDocument({ content: entry.item.originalPrompt, language: "markdown" }); await vscode.window.showTextDocument(doc); } }), vscode.commands.registerCommand("promptguard.openSettings", () => vscode.commands.executeCommand("workbench.action.openSettings", "@ext:promptguard")), vscode.workspace.onDidSaveTextDocument(document => { if (getSettings().analyzeOnSave && vscode.window.activeTextEditor?.document === document) void analyze(false); }));

  context.subscriptions.push(vscode.commands.registerCommand("promptguard.validateBudget", () => { void validateBudget(); }));
  context.subscriptions.push(vscode.commands.registerCommand("promptguard.exportPromptHandoff", () => { void exportPromptHandoff(); }));
  context.subscriptions.push(vscode.commands.registerCommand("promptguard.runBenchmarks", () => { void runBenchmarks(); }));
  context.subscriptions.push(vscode.commands.registerCommand("promptguard.exportAuditReport", () => { void exportAuditReport(); }));
  context.subscriptions.push(vscode.commands.registerCommand("promptguard.manageProviderOptIn", () => { void manageProviderOptIn(); }));
  context.subscriptions.push(vscode.commands.registerCommand("promptguard.browseProviders", () => { void browseProviders(); }));
  context.subscriptions.push(vscode.commands.registerCommand("promptguard.browseTemplates", () => { void browseTemplates(); }));
  context.subscriptions.push(vscode.commands.registerCommand("promptguard.insertTemplateSnippet", () => { void insertTemplateSnippet(); }));
  context.subscriptions.push(vscode.commands.registerCommand("promptguard.createReusableTemplate", () => { void createReusableTemplate(); }));
  context.subscriptions.push(vscode.commands.registerCommand("promptguard.openDuplicateDetection", () => { void openDuplicateDetection(); }));
  context.subscriptions.push(lintDiagnostics);
  context.subscriptions.push(vscode.languages.registerCodeActionsProvider({ scheme: "untitled" }, new PromptGuardCodeActions(), { providedCodeActionKinds: PromptGuardCodeActions.providedCodeActionKinds }));
  context.subscriptions.push(vscode.workspace.onDidOpenTextDocument(document => { refreshDiagnostics(document); }));
  context.subscriptions.push(vscode.workspace.onDidSaveTextDocument(document => { refreshDiagnostics(document); }));
  context.subscriptions.push(vscode.workspace.onDidCloseTextDocument(document => { lintDiagnostics.delete(document.uri); }));
  for (const document of vscode.workspace.textDocuments) {
    refreshDiagnostics(document);
  }

  context.subscriptions.push(vscode.workspace.onDidChangeTextDocument(event => {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.uri.toString() !== event.document.uri.toString()) {
      return;
    }
    refreshDiagnostics(event.document);
  }));

  void ensurePathModeInitialized();

}
export function deactivate(): void {}



