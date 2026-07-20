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
    this.item("Onboarding Status", "account", undefined, this.stateLabel(this.onboardingState)), this.item("Current Prompt", "shield", "promptguard.analyze"), this.item("History", "history", "promptguard.showHistory"), this.item("Analytics", "graph", "promptguard.openDashboard"), this.item("Rules", "checklist", "promptguard.openDashboard"), this.item("Settings", "gear", "promptguard.openSettings"), this.item("Leaderboard", "trophy", undefined, "Coming soon")
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
