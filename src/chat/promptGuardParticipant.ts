import * as vscode from "vscode";
import { PromptAnalyzer } from "../analysis/promptAnalyzer";
import { CostEstimator } from "../cost/costEstimator";
import { PromptHistoryEntry } from "../types";
import { PromptGuardSettings } from "../config/settings";

export type ChatAnalysisSink = (result: ReturnType<PromptAnalyzer["analyze"]>, entry: PromptHistoryEntry) => Promise<void>;

export class PromptGuardParticipant {
  constructor(private readonly analyzer: PromptAnalyzer, private readonly settings: () => PromptGuardSettings, private readonly onAnalysis: ChatAnalysisSink) {}

  async handle(request: vscode.ChatRequest, _context: vscode.ChatContext, response: vscode.ChatResponseStream, token: vscode.CancellationToken): Promise<void> {
    const settings = this.settings();
    if (!settings.enabled || request.prompt.trim().length < settings.minimumPromptLength) { response.markdown("Please enter a fuller prompt for analysis."); return; }
    const result = this.analyzer.analyze(request.prompt, settings.disabledRules);
    const model = { vendor: request.model.vendor, id: request.model.id, family: request.model.family, name: request.model.name };
    let inputTokens: number | undefined;
    try { inputTokens = await request.model.countTokens(request.prompt, token); } catch { /* Provider has no token counter; use local estimate. */ }
    result.cost = new CostEstimator().estimate(request.prompt, result.issues, { inputTokens, model, pricing: settings.modelPricing });
    await this.onAnalysis(result, { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, timestamp: result.analyzedAt, originalPrompt: request.prompt, optimizedPrompt: result.optimization.optimizedPrompt, score: result.score.total, improvement: Math.max(0, 100 - result.score.total), estimatedSavings: result.cost.potentialSavingsUsd ?? 0 });
    const findings = result.issues.slice(0, 6).map(issue => `- **${issue.title}** — ${issue.suggestedFix}`).join("\n") || "No active findings.";
    const tokenLabel = inputTokens === undefined ? `~${result.cost.inputTokens} estimated` : `${result.cost.inputTokens} exact`;
    const costLabel = result.cost.estimatedCostUsd === undefined ? "Unavailable — add a local `promptguard.modelPricing` profile for this model." : `$${result.cost.estimatedCostUsd.toFixed(6)} estimated`;
    response.markdown(`## PromptGuard · ${result.score.total}/100\n\n**Model:** ${model.name} (${model.vendor})  \n**Input tokens:** ${tokenLabel}  \n**Cost:** ${costLabel}\n\n### Findings\n${findings}`);
    response.button({ command: "promptguard.openDashboard", title: "Open PromptGuard dashboard" });
  }
}
