import * as vscode from "vscode";
import { PricingProfile } from "../types";
export interface PromptGuardSettings { enabled: boolean; analyzeOnSave: boolean; minimumPromptLength: number; disabledRules: string[]; ignoreComments: boolean; modelPricing: PricingProfile[]; }
export const getSettings = (): PromptGuardSettings => {
  const c = vscode.workspace.getConfiguration("promptguard");
  return { enabled: c.get("enabled", true), analyzeOnSave: c.get("analyzeOnSave", true), minimumPromptLength: c.get("minimumPromptLength", 20), disabledRules: c.get("disabledRules", []), ignoreComments: c.get("ignoreComments", false), modelPricing: c.get("modelPricing", []) };
};
