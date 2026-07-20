import * as vscode from "vscode";
import { PricingProfile, ProviderPricingProfile } from "../types";

export type AssessmentPathMode = "alwaysAsk" | "preferLocal" | "preferGroq";
export type GroqKeyMode = "strictProjectOnly" | "workspaceThenProcessEnv";
export interface LiveTokenPricing { inputPerMillionUsd: number; outputPerMillionUsd: number; }
export interface PromptGuardSettings { enabled: boolean; analyzeOnSave: boolean; minimumPromptLength: number; disabledRules: string[]; ignoreComments: boolean; modelPricing: PricingProfile[]; providerPricing: ProviderPricingProfile[]; costSimulatorMonthlyRuns: number; assessmentPathMode: AssessmentPathMode; groqKeyMode: GroqKeyMode; enableLiveTokenProfiler: boolean; enableBudgetMode: boolean; liveTokenPricing: LiveTokenPricing; enableLearningStore: boolean; }
export const getSettings = (): PromptGuardSettings => {
  const c = vscode.workspace.getConfiguration("promptguard");
  return { enabled: c.get("enabled", true), analyzeOnSave: c.get("analyzeOnSave", false), minimumPromptLength: c.get("minimumPromptLength", 20), disabledRules: c.get("disabledRules", []), ignoreComments: c.get("ignoreComments", false), modelPricing: c.get("modelPricing", []), providerPricing: c.get("providerPricing", []), costSimulatorMonthlyRuns: c.get("costSimulatorMonthlyRuns", 500), assessmentPathMode: c.get("assessmentPathMode", "alwaysAsk"), groqKeyMode: c.get("groqKeyMode", "strictProjectOnly"), enableLiveTokenProfiler: c.get("enableLiveTokenProfiler", true), enableBudgetMode: c.get("enableBudgetMode", true), liveTokenPricing: c.get("liveTokenPricing", { inputPerMillionUsd: 0.075, outputPerMillionUsd: 0.30 }), enableLearningStore: c.get("enableLearningStore", false) };
};
