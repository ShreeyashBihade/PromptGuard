import * as vscode from "vscode";
import { LocalPromptAdvisor } from "../analysis/localPromptAdvisor";
import { PromptAnalyzer } from "../analysis/promptAnalyzer";
import { CostEstimator } from "../cost/costEstimator";
import { PromptHistoryEntry } from "../types";
import { PromptGuardSettings } from "../config/settings";

export type ChatAnalysisSink = (result: ReturnType<PromptAnalyzer["analyze"]>, entry: PromptHistoryEntry, withGroq: boolean) => Promise<void>;
export type PathSelector = () => Promise<boolean | undefined>;

export class PromptGuardParticipant {
  private readonly advisor = new LocalPromptAdvisor();

  constructor(private readonly analyzer: PromptAnalyzer, private readonly settings: () => PromptGuardSettings, private readonly onAnalysis: ChatAnalysisSink, private readonly selectPath: PathSelector) {}

  async handle(request: vscode.ChatRequest, _context: vscode.ChatContext, response: vscode.ChatResponseStream, token: vscode.CancellationToken): Promise<void> {
    if (request.command === "settings" || request.command === "preferences") {
      response.markdown("PromptGuard preferences:\n- Use **Toggle Path Mode** to switch Always Ask / Prefer Local / Prefer Groq\n- Open extension settings for deeper configuration");
      response.button({ command: "promptguard.preferences", title: "Open PromptGuard preferences" });
      response.button({ command: "promptguard.openSettings", title: "Open extension settings" });
      return;
    }
    const settings = this.settings();
    if (!settings.enabled || request.prompt.trim().length < settings.minimumPromptLength) { response.markdown("Please enter a fuller prompt for analysis."); return; }
    const result = this.analyzer.analyze(request.prompt, settings.disabledRules);
    const withGroq = await this.selectPath();
    if (withGroq === undefined) { response.markdown("PromptGuard: analysis cancelled."); return; }
    const model = { vendor: request.model.vendor, id: request.model.id, family: request.model.family, name: request.model.name };
    let inputTokens: number | undefined;
    try { inputTokens = await request.model.countTokens(request.prompt, token); } catch { /* Provider has no token counter; use local estimate. */ }
    result.cost = new CostEstimator().estimate(request.prompt, result.issues, { inputTokens, model, pricing: settings.modelPricing });
    result.localInsights = this.advisor.build(request.prompt, withGroq ? "cloud-assisted" : "local-only");
    try {
      await this.onAnalysis(result, { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, timestamp: result.analyzedAt, originalPrompt: request.prompt, optimizedPrompt: result.optimization.optimizedPrompt, score: result.score.total, improvement: Math.max(0, 100 - result.score.total), estimatedSavings: result.cost.potentialSavingsUsd ?? 0 }, withGroq);
    } catch (error) {
      response.markdown(`PromptGuard onboarding is mandatory before analysis. ${error instanceof Error ? error.message : "Complete cloud onboarding first."}`);
      response.button({ command: "promptguard.completeOnboarding", title: "Complete PromptGuard onboarding" });
      return;
    }
    const findings = result.issues.slice(0, 6).map(issue => `- **${issue.title}** — ${issue.suggestedFix}`).join("\n") || "No active findings.";
    const tokenLabel = inputTokens === undefined ? `~${result.cost.inputTokens} estimated` : `${result.cost.inputTokens} exact`;
    const costLabel = result.cost.estimatedCostUsd === undefined ? "Unavailable — add a local `promptguard.modelPricing` profile for this model." : `$${result.cost.estimatedCostUsd.toFixed(6)} estimated`;
    const bestPractices = result.localInsights?.bestPractices.map(item => `- ${item}`).join("\n") ?? "- Add explicit output format and constraints.";
    const modelRecommendations = result.localInsights?.recommendations.map(rec => `- **${rec.provider}/${rec.model}** (${rec.fit} fit): ${rec.rationale}`).join("\n") ?? "- No recommendation available.";
    response.markdown(`## PromptGuard · ${result.score.total}/100\n\n**Model:** ${model.name} (${model.vendor})  \n**Input tokens:** ${tokenLabel}  \n**Cost:** ${costLabel}\n\n### Findings\n${findings}\n\n### Local best practices\n${bestPractices}\n\n### Suggested models\n${modelRecommendations}`);
    response.button({ command: "promptguard.improve", title: "Expand prompt" });
    response.button({ command: "promptguard.optimize", title: "Minimize / optimize prompt" });
    response.button({ command: "promptguard.logout", title: "Logout" });
    response.button({ command: "promptguard.deleteData", title: "Delete account data" });
    response.button({ command: "promptguard.openDashboard", title: "Open PromptGuard dashboard" });
  }
}
