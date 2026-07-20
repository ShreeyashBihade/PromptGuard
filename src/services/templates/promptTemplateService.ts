import * as fs from "fs";
import * as path from "path";

export type PromptTemplateScope = "workspace" | "team" | "global";

export interface PromptTemplateVariable {
  readonly name: string;
  readonly description?: string;
  readonly defaultValue?: string;
}

export interface PromptTemplate {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly content: string;
  readonly tags?: readonly string[];
  readonly scope: PromptTemplateScope;
  readonly sourcePath: string;
  readonly variables: readonly PromptTemplateVariable[];
}

export interface PromptTemplateFile {
  readonly version: 1;
  readonly name?: string;
  readonly scope: PromptTemplateScope;
  readonly sourcePath: string;
  readonly templates: readonly PromptTemplate[];
}

export class PromptTemplateService {
  private readonly cache = new Map<string, PromptTemplateFile>();

  constructor(private readonly workspaceRoot?: string, private readonly globalStorageRoot?: string) {}

  load(): PromptTemplateFile | undefined {
    return this.loadCatalog("workspace");
  }

  loadCatalog(scope: PromptTemplateScope): PromptTemplateFile | undefined {
    const sourcePath = this.templatePath(scope);
    if (!sourcePath) {
      return undefined;
    }

    const cached = this.cache.get(sourcePath);
    if (cached) {
      return cached;
    }

    if (!fs.existsSync(sourcePath)) {
      return undefined;
    }

    const parsed = this.parse(fs.readFileSync(sourcePath, "utf8"), scope, sourcePath);
    if (!parsed) {
      return undefined;
    }

    this.cache.set(sourcePath, parsed);
    return parsed;
  }

  loadCatalogs(): readonly PromptTemplateFile[] {
    return [this.loadCatalog("workspace"), this.loadCatalog("team"), this.loadCatalog("global")].filter((catalog): catalog is PromptTemplateFile => Boolean(catalog));
  }

  listTemplates(scope?: PromptTemplateScope): readonly PromptTemplate[] {
    if (scope) {
      return this.loadCatalog(scope)?.templates ?? [];
    }

    return this.loadCatalogs().flatMap(catalog => catalog.templates);
  }

  getTemplateContent(template: PromptTemplate, variables: Readonly<Record<string, string>> = {}): string {
    return this.expandTemplate(template.content, variables);
  }

  buildSnippetBody(template: PromptTemplate): string {
    return this.snippetify(template.content, this.detectVariables(template.content));
  }

  expandTemplate(content: string, variables: Readonly<Record<string, string>> = {}): string {
    return content.replace(/\{\{\s*([\w-]+)\s*\}\}/g, (_, rawName: string) => {
      const name = String(rawName);
      return variables[name] ?? "";
    });
  }

  detectVariables(content: string): readonly PromptTemplateVariable[] {
    const seen = new Set<string>();
    const variables: PromptTemplateVariable[] = [];
    for (const match of content.matchAll(/\{\{\s*([\w-]+)\s*\}\}/g)) {
      const name = match[1];
      if (!name) {
        continue;
      }
      if (!seen.has(name)) {
        seen.add(name);
        variables.push({ name });
      }
    }
    return variables;
  }

  clearCache(): void {
    this.cache.clear();
  }

  private templatePath(scope: PromptTemplateScope): string | undefined {
    switch (scope) {
      case "workspace":
        return this.workspaceRoot ? path.join(this.workspaceRoot, "promptguard.templates.json") : undefined;
      case "team":
        return this.workspaceRoot ? path.join(this.workspaceRoot, ".promptguard", "templates.team.json") : undefined;
      case "global":
        return this.globalStorageRoot ? path.join(this.globalStorageRoot, "promptguard.templates.json") : undefined;
    }
  }

  private parse(source: string, scope: PromptTemplateScope, sourcePath: string): PromptTemplateFile | undefined {
    try {
      const value = JSON.parse(source) as Partial<PromptTemplateFile>;
      if (value.version !== 1 || !Array.isArray(value.templates)) {
        return undefined;
      }
      const templates = value.templates.filter((template): template is PromptTemplate => {
        return typeof template === "object" && template !== null && typeof (template as { id?: unknown }).id === "string" && typeof (template as { name?: unknown }).name === "string" && typeof (template as { description?: unknown }).description === "string" && typeof (template as { content?: unknown }).content === "string";
      });

      const normalizedTemplates = templates.map(template => ({
        ...template,
        scope,
        sourcePath,
        variables: this.normalizeVariables((template as { variables?: unknown }).variables, template.content)
      }));

      return { version: 1, name: typeof value.name === "string" ? value.name : undefined, scope, sourcePath, templates: normalizedTemplates };
    } catch {
      return undefined;
    }
  }

  private normalizeVariables(rawVariables: unknown, content: string): readonly PromptTemplateVariable[] {
    const detected = this.detectVariables(content);
    if (!Array.isArray(rawVariables) || !rawVariables.length) {
      return detected;
    }

    const variables = rawVariables.flatMap(variable => {
      if (typeof variable === "string") {
        return [{ name: variable }];
      }

      if (typeof variable === "object" && variable !== null && typeof (variable as { name?: unknown }).name === "string") {
        return [{
          name: (variable as { name: string }).name,
          description: typeof (variable as { description?: unknown }).description === "string" ? (variable as { description?: string }).description : undefined,
          defaultValue: typeof (variable as { defaultValue?: unknown }).defaultValue === "string" ? (variable as { defaultValue?: string }).defaultValue : undefined
        }];
      }

      return [];
    });

    const seen = new Set(variables.map(variable => variable.name));
    for (const variable of detected) {
      if (!seen.has(variable.name)) {
        variables.push(variable);
      }
    }

    return variables;
  }

  private snippetify(content: string, variables: readonly PromptTemplateVariable[]): string {
    const indexByName = new Map<string, number>();
    let nextIndex = 1;

    return content.replace(/\{\{\s*([\w-]+)\s*\}\}/g, (_, rawName: string) => {
      const name = String(rawName);
      let index = indexByName.get(name);
      if (!index) {
        index = nextIndex;
        nextIndex += 1;
        indexByName.set(name, index);
      }
      return `\${${index}:${name}}`;
    });
  }
}
