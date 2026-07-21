import * as fs from "fs";
import * as path from "path";
import { PromptPolicyRule } from "./promptPolicyService";

export interface PromptPolicyPack {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly enabled?: boolean;
  readonly rules: readonly PromptPolicyRule[];
}

export interface PromptPolicyPackFile {
  readonly version: 1;
  readonly name?: string;
  readonly packs: readonly PromptPolicyPack[];
}

export interface PromptPolicyPackReport {
  readonly source?: string;
  readonly loaded: boolean;
  readonly packCount: number;
  readonly enabledPackCount: number;
  readonly packs: readonly PromptPolicyPack[];
}

const DEFAULT_POLICY_PACK_FILE = "promptguard.policy-packs.json";

export class PromptPolicyPackService {
  private readonly cache = new Map<string, PromptPolicyPackFile>();

  constructor(private readonly workspaceRoot?: string, private readonly fileName = DEFAULT_POLICY_PACK_FILE) {}

  load(): PromptPolicyPackFile | undefined {
    const file = this.policyPackPath();
    if (!file) return undefined;
    const cached = this.cache.get(file);
    if (cached) return cached;
    if (!fs.existsSync(file)) return undefined;
    const parsed = this.parse(fs.readFileSync(file, "utf8"));
    if (!parsed) return undefined;
    this.cache.set(file, parsed);
    return parsed;
  }

  list(): PromptPolicyPackReport {
    const file = this.load();
    if (!file) return { loaded: false, packCount: 0, enabledPackCount: 0, packs: [] };
    const enabledPackCount = file.packs.filter(pack => pack.enabled !== false).length;
    return { source: this.policyPackPath(), loaded: true, packCount: file.packs.length, enabledPackCount, packs: file.packs };
  }

  renderMarkdown(): string {
    const report = this.list();
    const lines: string[] = [];
    lines.push(`# PromptGuard Policy Packs`);
    lines.push(``);
    lines.push(`- Workspace file: ${report.loaded ? "promptguard.policy-packs.json" : "not loaded"}`);
    lines.push(`- Packs: ${report.packCount}`);
    lines.push(`- Enabled packs: ${report.enabledPackCount}`);
    lines.push(``);

    if (!report.loaded || !report.packs.length) {
      lines.push(`No policy packs were found in the workspace.`);
      return `${lines.join("\n")}\n`;
    }

    for (const pack of report.packs) {
      lines.push(`## ${pack.name}`);
      lines.push(`- ID: ${pack.id}`);
      lines.push(`- Enabled: ${pack.enabled === false ? "no" : "yes"}`);
      if (pack.description) lines.push(`- ${pack.description}`);
      lines.push(`- Rules: ${pack.rules.length}`);
      for (const rule of pack.rules) lines.push(`  - ${rule.id}: ${rule.description}`);
      lines.push(``);
    }

    return `${lines.join("\n")}\n`;
  }

  clearCache(): void {
    this.cache.clear();
  }

  private policyPackPath(): string | undefined {
    if (!this.workspaceRoot) return undefined;
    return path.join(this.workspaceRoot, this.fileName);
  }

  private parse(source: string): PromptPolicyPackFile | undefined {
    try {
      const value = JSON.parse(source) as Partial<PromptPolicyPackFile>;
      if (value.version !== 1 || !Array.isArray(value.packs)) return undefined;
      const packs = value.packs.filter((pack): pack is PromptPolicyPack => typeof pack === "object" && pack !== null && typeof (pack as { id?: unknown }).id === "string" && typeof (pack as { name?: unknown }).name === "string" && Array.isArray((pack as { rules?: unknown }).rules)).map(pack => ({
        id: pack.id,
        name: pack.name,
        description: typeof pack.description === "string" ? pack.description : undefined,
        enabled: typeof pack.enabled === "boolean" ? pack.enabled : undefined,
        rules: pack.rules.filter((rule): rule is PromptPolicyRule => typeof rule === "object" && rule !== null && typeof (rule as { id?: unknown }).id === "string" && typeof (rule as { description?: unknown }).description === "string").map(rule => ({
          id: rule.id,
          description: rule.description,
          pattern: typeof rule.pattern === "string" ? rule.pattern : undefined,
          minLength: typeof rule.minLength === "number" ? rule.minLength : undefined,
          maxLength: typeof rule.maxLength === "number" ? rule.maxLength : undefined,
          requiredTerms: Array.isArray(rule.requiredTerms) ? rule.requiredTerms.filter((term): term is string => typeof term === "string") : undefined,
          forbiddenTerms: Array.isArray(rule.forbiddenTerms) ? rule.forbiddenTerms.filter((term): term is string => typeof term === "string") : undefined
        }))
      }));
      return { version: 1, name: typeof value.name === "string" ? value.name : undefined, packs };
    } catch {
      return undefined;
    }
  }
}
