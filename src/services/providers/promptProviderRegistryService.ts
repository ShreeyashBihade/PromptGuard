import * as fs from "fs";
import { promises as fsPromises } from "node:fs";
import * as path from "path";
import { PromptProviderCatalogFile, PromptProviderId } from "./promptProviderCatalogService";

export interface PromptProviderRegistryEntry {
  readonly id: PromptProviderId;
  readonly enabled: boolean;
  readonly preferredModels: readonly string[];
}

export interface PromptProviderRegistryReport {
  readonly source?: string;
  readonly loaded: boolean;
  readonly providers: readonly PromptProviderRegistryEntry[];
}

const DEFAULT_FILE = "promptguard.providers.json";

export class PromptProviderRegistryService {
  private readonly cache = new Map<string, PromptProviderCatalogFile>();

  constructor(private readonly workspaceRoot?: string, private readonly fileName = DEFAULT_FILE) {}

  list(): PromptProviderRegistryReport {
    const catalog = this.load();
    if (!catalog) {
      return { loaded: false, providers: [] };
    }

    return {
      source: this.catalogPath(),
      loaded: true,
      providers: catalog.providers.map(provider => ({
        id: provider.id,
        enabled: provider.enabled ?? provider.id === "groq",
        preferredModels: provider.preferredModels ?? []
      }))
    };
  }

  async setEnabled(id: PromptProviderId, enabled: boolean, preferredModels: readonly string[] = []): Promise<PromptProviderRegistryReport> {
    const catalogPath = this.catalogPath();
    if (!catalogPath) {
      throw new Error("Open a workspace folder to edit provider opt-in settings.");
    }

    const catalog = this.load() ?? { version: 1, providers: [] };
    const existing = catalog.providers.find(provider => provider.id === id);
    const providers = catalog.providers.filter(provider => provider.id !== id);
    providers.push({ id, enabled, preferredModels: preferredModels.length ? preferredModels : existing?.preferredModels });

    const updated: PromptProviderCatalogFile = { version: 1, providers: providers.sort((a, b) => a.id.localeCompare(b.id)) };
    await fsPromises.mkdir(path.dirname(catalogPath), { recursive: true });
    await fsPromises.writeFile(catalogPath, `${JSON.stringify(updated, null, 2)}\n`, "utf8");
    this.cache.set(catalogPath, updated);
    return this.list();
  }

  clearCache(): void {
    this.cache.clear();
  }

  private load(): PromptProviderCatalogFile | undefined {
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

    try {
      const parsed = JSON.parse(fs.readFileSync(catalogPath, "utf8")) as PromptProviderCatalogFile;
      if (parsed.version !== 1 || !Array.isArray(parsed.providers)) {
        return undefined;
      }
      this.cache.set(catalogPath, parsed);
      return parsed;
    } catch {
      return undefined;
    }
  }

  private catalogPath(): string | undefined {
    if (!this.workspaceRoot) {
      return undefined;
    }
    return path.join(this.workspaceRoot, this.fileName);
  }
}