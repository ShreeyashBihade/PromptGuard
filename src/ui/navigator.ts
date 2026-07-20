import * as vscode from "vscode";
import { OnboardingState } from "../services/onboarding/onboardingStateMachine";

export class NavigatorProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private readonly changed = new vscode.EventEmitter<void>(); readonly onDidChangeTreeData = this.changed.event;
  private onboardingState: OnboardingState = "idle";

  setOnboardingState(state: OnboardingState): void {
    this.onboardingState = state;
    this.refresh();
  }

  refresh(): void { this.changed.fire(); }
  getTreeItem(item: vscode.TreeItem): vscode.TreeItem { return item; }
  getChildren(): vscode.TreeItem[] { return [
    this.item("Onboarding Status", "account", undefined, this.stateLabel(this.onboardingState)), this.item("Current Prompt", "shield", "promptguard.analyze"), this.item("Dead Code Elimination", "trash", "promptguard.openDeadCodeElimination"), this.item("Context Optimizer", "wand-sparkles", "promptguard.openContextOptimizer"), this.item("Duplicate Detection", "layers", "promptguard.openDuplicateDetection"), this.item("History", "history", "promptguard.showHistory"), this.item("Analytics", "graph", "promptguard.openDashboard"), this.item("Rules", "checklist", "promptguard.validatePolicy"), this.item("Policy Packs", "library", "promptguard.browsePolicyPacks"), this.item("Budget", "database", "promptguard.validateBudget"), this.item("Prompt Templates", "library", "promptguard.browseTemplates"), this.item("Insert Template Snippet", "insert", "promptguard.insertTemplateSnippet"), this.item("Convert to Template", "symbol-template", "promptguard.createReusableTemplate"), this.item("Learning", "heart", "promptguard.showLearningSummary"), this.item("Benchmarks", "flame", "promptguard.runBenchmarks"), this.item("Audit", "book", "promptguard.exportAuditReport"), this.item("Handoff", "export", "promptguard.exportPromptHandoff"), this.item("Providers", "plug", "promptguard.browseProviders"), this.item("Provider Opt-In", "toggle-right", "promptguard.manageProviderOptIn"), this.item("Settings", "gear", "promptguard.settings"), this.item("Leaderboard", "trophy", undefined, "Coming soon")
  ]; }
  private item(label: string, icon: string, command?: string, description?: string): vscode.TreeItem { const item = new vscode.TreeItem(label); item.iconPath = new vscode.ThemeIcon(icon); item.description=description; if(command) item.command={ command, title: label }; return item; }

  private stateLabel(state: OnboardingState): string {
    switch (state) {
      case "activated": return "Activated";
      case "policy-pending": return "Consent pending";
      case "verification-pending": return "OTP pending";
      case "project-pending": return "Project pending";
      case "api-unconfigured": return "API unconfigured";
      case "api-error": return "API error";
      default: return "Idle";
    }
  }
}
