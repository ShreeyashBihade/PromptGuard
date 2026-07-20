import * as fs from "fs";
import * as path from "path";
import { AnalysisResult } from "../../types";

export interface PromptPolicyRule {
  readonly id: string;
  readonly description: string;
  readonly pattern?: string;
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly requiredTerms?: readonly string[];
  readonly forbiddenTerms?: readonly string[];
}

export interface PromptPolicySettings {
  readonly maxTokens?: number;
  readonly requireOutput?: boolean;
  readonly forbidSecrets?: boolean;
  readonly requireConstraints?: boolean;
}

export interface PromptPolicyFile {
  readonly version?: 1;
  readonly name?: string;
  readonly maxTokens?: number;
  readonly requireOutput?: boolean;
  readonly forbidSecrets?: boolean;
  readonly requireConstraints?: boolean;
  readonly rules: readonly PromptPolicyRule[];
}

export interface PromptPolicyViolation {
  readonly ruleId: string;
  readonly description: string;
  readonly message: string;
}

export interface PromptPolicyReport {
  readonly source?: string;
  readonly loaded: boolean;
  readonly ruleCount: number;
  readonly violations: readonly PromptPolicyViolation[];
}

export class PromptPolicyService {
  private readonly cache = new Map<string, PromptPolicyFile>();

  constructor(private readonly workspaceRoot?: string) {}

  load(): PromptPolicyFile | undefined {
    const configPath = this.policyPath();
    if (!configPath) {
      return undefined;
    }

    const cached = this.cache.get(configPath);
    if (cached) {
      return cached;
    }

    if (!fs.existsSync(configPath)) {
      return undefined;
    }

    const parsed = this.parse(fs.readFileSync(configPath, "utf8"));
    if (!parsed) {
      return undefined;
    }

    this.cache.set(configPath, parsed);
    return parsed;
  }

  validate(prompt: string, analysis?: AnalysisResult): PromptPolicyReport {
    const policy = this.load();
    if (!policy) {
      return { loaded: false, ruleCount: 0, violations: [] };
    }

    const violations = [
      ...this.validateSettings(prompt, policy, analysis),
      ...policy.rules.flatMap(rule => this.validateRule(prompt, rule))
    ];
    return { source: this.policyPath(), loaded: true, ruleCount: policy.rules.length + this.settingsCount(policy), violations };
  }

  clearCache(): void {
    this.cache.clear();
  }

  private validateRule(prompt: string, rule: PromptPolicyRule): PromptPolicyViolation[] {
    const normalized = prompt.toLowerCase();
    const violations: PromptPolicyViolation[] = [];

    if (typeof rule.minLength === "number" && prompt.length < rule.minLength) {
      violations.push(this.violation(rule, `Prompt must be at least ${rule.minLength} characters.`));
    }
    if (typeof rule.maxLength === "number" && prompt.length > rule.maxLength) {
      violations.push(this.violation(rule, `Prompt must be at most ${rule.maxLength} characters.`));
    }
    if (typeof rule.pattern === "string" && rule.pattern.trim()) {
      try {
        const expression = new RegExp(rule.pattern, "i");
        if (!expression.test(prompt)) {
          violations.push(this.violation(rule, `Prompt must match pattern /${rule.pattern}/.`));
        }
      } catch {
        violations.push(this.violation(rule, `Invalid policy pattern /${rule.pattern}/.`));
      }
    }
    for (const term of rule.requiredTerms ?? []) {
      if (!normalized.includes(term.toLowerCase())) {
        violations.push(this.violation(rule, `Prompt must include "${term}".`));
      }
    }
    for (const term of rule.forbiddenTerms ?? []) {
      if (normalized.includes(term.toLowerCase())) {
        violations.push(this.violation(rule, `Prompt must not include "${term}".`));
      }
    }

    return violations;
  }

  private violation(rule: PromptPolicyRule, message: string): PromptPolicyViolation {
    return { ruleId: rule.id, description: rule.description, message };
  }

  private validateSettings(prompt: string, policy: PromptPolicyFile, analysis?: AnalysisResult): PromptPolicyViolation[] {
    const violations: PromptPolicyViolation[] = [];
    const normalized = prompt.toLowerCase();
    const tokenCount = analysis?.cost.inputTokens ?? Math.ceil(prompt.length / 4);

    if (typeof policy.maxTokens === "number" && tokenCount > policy.maxTokens) {
      violations.push({ ruleId: "policy:maxTokens", description: "Prompt token budget", message: `Prompt uses ${tokenCount} tokens, above the ${policy.maxTokens} token limit.` });
    }

    if (policy.requireOutput) {
      const hasOutput = /\b(output|format|return|respond|json|markdown|table|bullets?)\b/i.test(prompt);
      if (!hasOutput) {
        violations.push({ ruleId: "policy:requireOutput", description: "Prompt output requirements", message: "Prompt must specify an output format or response shape." });
      }
    }

    if (policy.forbidSecrets) {
      if (/(api[_-]?key|api\s+key|secret|token|password|passwd|private key|ssh-rsa|bearer\s+[a-z0-9._-]+)/i.test(prompt)) {
        violations.push({ ruleId: "policy:forbidSecrets", description: "Secret leakage prevention", message: "Prompt must not contain secrets or secret-like tokens." });
      }
    }

    if (policy.requireConstraints) {
      const hasConstraints = /(must|must not|avoid|limit|only|exactly|at most|under|include|exclude|constraints?|requirements?)/i.test(prompt);
      if (!hasConstraints) {
        violations.push({ ruleId: "policy:requireConstraints", description: "Prompt constraint requirements", message: "Prompt must include explicit constraints or requirements." });
      }
    }

    return violations;
  }

  private settingsCount(policy: PromptPolicyFile): number {
    return [policy.maxTokens, policy.requireOutput, policy.forbidSecrets, policy.requireConstraints].filter(value => value !== undefined).length;
  }

  private policyPath(): string | undefined {
    if (!this.workspaceRoot) {
      return undefined;
    }
    return path.join(this.workspaceRoot, "promptguard.json");
  }

  private parse(source: string): PromptPolicyFile | undefined {
    try {
      const value = JSON.parse(source) as Partial<PromptPolicyFile>;
      const settings: PromptPolicySettings = {
        maxTokens: typeof value.maxTokens === "number" ? value.maxTokens : undefined,
        requireOutput: typeof value.requireOutput === "boolean" ? value.requireOutput : undefined,
        forbidSecrets: typeof value.forbidSecrets === "boolean" ? value.forbidSecrets : undefined,
        requireConstraints: typeof value.requireConstraints === "boolean" ? value.requireConstraints : undefined
      };

      const rules = Array.isArray(value.rules)
        ? value.rules.filter((rule): rule is PromptPolicyRule => {
          return typeof rule === "object" && rule !== null && typeof (rule as { id?: unknown }).id === "string" && typeof (rule as { description?: unknown }).description === "string";
        })
        : [];

      if (value.version !== undefined && value.version !== 1) {
        return undefined;
      }

      if (!rules.length && !settings.maxTokens && !settings.requireOutput && !settings.forbidSecrets && !settings.requireConstraints) {
        return undefined;
      }

      return { version: 1, name: typeof value.name === "string" ? value.name : undefined, ...settings, rules };
    } catch {
      return undefined;
    }
  }
}
