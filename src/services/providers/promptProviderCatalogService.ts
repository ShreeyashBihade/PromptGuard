import * as fs from "fs";
import * as path from "path";
import { LocalPromptAdvisor } from "../../analysis/localPromptAdvisor";

export type PromptProviderId = "groq" | "openai" | "claude" | "gemini";

export interface PromptProviderProfile {
  readonly id: PromptProviderId;
  readonly displayName: string;
  readonly enabled: boolean;
  readonly recommendedModels: readonly string[];
  readonly setupNotes: readonly string[];
}

export interface PromptProviderCatalogFile {
  readonly version: 1;
  readonly providers: readonly { id: PromptProviderId; enabled?: boolean; preferredModels?: readonly string[] }[];
}

export interface PromptProviderCatalogReport {
  readonly source?: string;
  readonly loaded: boolean;
  readonly providers: readonly PromptProviderProfile[];
  readonly recommendations: readonly { provider: PromptProviderId; model: string; rationale: string }[];
}

const DEFAULT_FILE = "promptguard.providers.json";

const CATALOG: Record<PromptProviderId, Omit<PromptProviderProfile, "enabled">> = {
  groq: {
    id: "groq",
    displayName: "Groq",
    recommendedModels: ["llama-3.3-70b-versatile", "llama-3.1-8b-instant", "mixtral-8x7b-32768"],
    setupNotes: ["Uses the existing PromptGuard Groq provider.", "Enable only when a GROQ_API_KEY is configured.", "Best fit for low-latency local-first cloud assist."]
  },
  openai: {
    id: "openai",
    displayName: "OpenAI",
    recommendedModels: ["gpt-4.1", "gpt-4.1-mini", "gpt-4o"],
    setupNotes: ["Opt in only after adding an OpenAI API key.", "Use for tool-use, code, and high-precision rewrite workflows.", "Keep disabled for confidential prompts unless policy allows external transfer."]
  },
  claude: {
    id: "claude",
    displayName: "Claude",
    recommendedModels: ["claude-3.5-sonnet", "claude-3-opus", "claude-3-haiku"],
    setupNotes: ["Opt in only after adding an Anthropic API key.", "Good for structured writing and long-form reasoning.", "Keep disabled for prompts that must remain local-only."]
  },
  gemini: {
    id: "gemini",
    displayName: "Gemini",
    recommendedModels: ["gemini-1.5-pro", "gemini-1.5-flash", "gemini-1.0-pro"],
    setupNotes: ["Opt in only after adding a Gemini API key.", "Good for long-context analysis and multimodal workflows.", "Prefer explicit task framing and output constraints."]
  }
};

export class PromptProviderCatalogService {
  private readonly advisor = new LocalPromptAdvisor();
  private readonly cache = new Map<string, PromptProviderCatalogFile>();

  constructor(private readonly workspaceRoot?: string, private readonly fileName = DEFAULT_FILE) {}

  load(): PromptProviderCatalogFile | undefined {
    const catalogPath = this.catalogPath();
    if (!catalogPath) {
      return undefined;
    }

    const cached = this.cache.get(catalogPath);
    if (cached) {
      return cached;
    }

    if (!fs.existsSync(catalogPath)) {
      return undefined;
    }

    const parsed = this.parse(fs.readFileSync(catalogPath, "utf8"));
    if (!parsed) {
      return undefined;
    }

    this.cache.set(catalogPath, parsed);
    return parsed;
  }

  listProfiles(prompt = ""): PromptProviderCatalogReport {
    const catalog = this.load();
    const config = new Map(catalog?.providers.map(provider => [provider.id, provider]) ?? []);
    const profiles = (Object.keys(CATALOG) as PromptProviderId[]).map(id => ({
      ...CATALOG[id],
      enabled: config.get(id)?.enabled ?? id === "groq"
    }));

    const recommendations = this.advisor.build(prompt, "cloud-assisted").recommendations.map(rec => ({
      provider: rec.provider,
      model: rec.model,
      rationale: rec.rationale
    }));

    return {
      source: this.catalogPath(),
      loaded: Boolean(catalog),
      providers: profiles,
      recommendations
    };
  }

  renderMarkdown(prompt = ""): string {
    const report = this.listProfiles(prompt);
    const lines: string[] = [];
    lines.push(`# PromptGuard Provider Catalog`);
    lines.push(``);
    lines.push(`- Workspace catalog: ${report.loaded ? "promptguard.providers.json" : "default guidance (no workspace file)"}`);
    lines.push(`- Prompt-aware recommendations: ${prompt.trim() ? "enabled" : "general"}`);
    lines.push(``);
    for (const profile of report.providers) {
      lines.push(`## ${profile.displayName}`);
      lines.push(`- Enabled: ${profile.enabled ? "yes" : "no"}`);
      lines.push(`- Suggested models: ${profile.recommendedModels.join(", ")}`);
      for (const note of profile.setupNotes) {
        lines.push(`- ${note}`);
      }
      lines.push(``);
    }
    lines.push(`## Local recommendations`);
    if (!report.recommendations.length) {
      lines.push(`- No recommendation available for the current prompt.`);
    } else {
      for (const recommendation of report.recommendations) {
        lines.push(`- ${recommendation.provider}/${recommendation.model}: ${recommendation.rationale}`);
      }
    }
    return `${lines.join("\n")}\n`;
  }

  clearCache(): void {
    this.cache.clear();
  }

  private catalogPath(): string | undefined {
    if (!this.workspaceRoot) {
      return undefined;
    }
    return path.join(this.workspaceRoot, this.fileName);
  }

  private parse(source: string): PromptProviderCatalogFile | undefined {
    try {
      const value = JSON.parse(source) as Partial<PromptProviderCatalogFile>;
      if (value.version !== 1 || !Array.isArray(value.providers)) {
        return undefined;
      }
      const providers = value.providers.filter((provider): provider is NonNullable<PromptProviderCatalogFile["providers"]>[number] => {
        return typeof provider === "object" && provider !== null && (provider.id === "groq" || provider.id === "openai" || provider.id === "claude" || provider.id === "gemini");
      }).map(provider => ({
        id: provider.id,
        enabled: typeof provider.enabled === "boolean" ? provider.enabled : undefined,
        preferredModels: Array.isArray(provider.preferredModels) ? provider.preferredModels.filter((model): model is string => typeof model === "string") : undefined
      }));
      return { version: 1, providers };
    } catch {
      return undefined;
    }
  }
}