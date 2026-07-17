import * as vscode from "vscode";
export class NavigatorProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private readonly changed = new vscode.EventEmitter<void>(); readonly onDidChangeTreeData = this.changed.event;
  refresh(): void { this.changed.fire(); }
  getTreeItem(item: vscode.TreeItem): vscode.TreeItem { return item; }
  getChildren(): vscode.TreeItem[] { return [
    this.item("Current Prompt", "shield", "promptguard.analyze"), this.item("History", "history", "promptguard.showHistory"), this.item("Analytics", "graph", "promptguard.openDashboard"), this.item("Rules", "checklist", "promptguard.openDashboard"), this.item("Settings", "gear", "promptguard.openSettings"), this.item("Leaderboard", "trophy", undefined, "Coming soon")
  ]; }
  private item(label: string, icon: string, command?: string, description?: string): vscode.TreeItem { const item = new vscode.TreeItem(label); item.iconPath = new vscode.ThemeIcon(icon); item.description=description; if(command) item.command={ command, title: label }; return item; }
}
