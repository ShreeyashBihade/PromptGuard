import { PromptHistoryEntry } from "../../types";
import { PromptAstParser } from "../../analysis/promptAstParser";
import { PromptTemplate, PromptTemplateScope, PromptTemplateService } from "./promptTemplateService";

export interface TemplateCatalogSummary {
  readonly scope: PromptTemplateScope;
  readonly templateCount: number;
  readonly name?: string;
  readonly sourcePath: string;
}

export interface TemplatePrefixSuggestion {
  readonly prefix: string;
  readonly occurrences: number;
  readonly currentOccurrences: number;
  readonly historyOccurrences: number;
  readonly estimatedSavingsTokens: number;
  readonly templatePreview: string;
  readonly snippetBody: string;
  readonly variables: readonly string[];
  readonly examples: readonly string[];
  readonly reason: string;
}

export interface TemplateWorkbenchReport {
  readonly generatedAt: string;
  readonly prompt: string;
  readonly catalogSummary: readonly TemplateCatalogSummary[];
  readonly templateCount: number;
  readonly suggestionCount: number;
  readonly method: "lightweight";
  readonly catalogTemplates: readonly PromptTemplate[];
  readonly prefixSuggestions: readonly TemplatePrefixSuggestion[];
}

export class PromptTemplateWorkbenchService {
  private readonly parser = new PromptAstParser();

  constructor(private readonly templateService: PromptTemplateService) {}

  review(prompt: string, history: readonly PromptHistoryEntry[] = []): TemplateWorkbenchReport {
    const catalogs = this.templateService.loadCatalogs();
    const catalogSummary = catalogs.map(catalog => ({
      scope: catalog.scope,
      templateCount: catalog.templates.length,
      name: catalog.name,
      sourcePath: catalog.sourcePath
    }));
    const catalogTemplates = catalogs.flatMap(catalog => catalog.templates);
    const prefixSuggestions = this.detectRepeatedPrefixes(prompt, history);

    return {
      generatedAt: new Date().toISOString(),
      prompt,
      catalogSummary,
      templateCount: catalogTemplates.length,
      suggestionCount: prefixSuggestions.length,
      method: "lightweight",
      catalogTemplates,
      prefixSuggestions
    };
  }

  buildReusableTemplate(suggestion: TemplatePrefixSuggestion): string {
    return `${suggestion.templatePreview}\n\n{{details}}`;
  }

  buildSnippetBody(suggestion: TemplatePrefixSuggestion): string {
    return this.templateService.buildSnippetBody({
      id: "prefix-suggestion",
      name: "Reusable prefix template",
      description: "Generated from repeated prompt prefixes",
      content: this.buildReusableTemplate(suggestion),
      scope: "workspace",
      sourcePath: "generated",
      variables: suggestion.variables.map(name => ({ name }))
    });
  }

  private detectRepeatedPrefixes(prompt: string, history: readonly PromptHistoryEntry[]): TemplatePrefixSuggestion[] {
    const blocks = this.parser.parse(prompt).children.filter(node => node.text.trim().length > 0);
    const samples = [
      ...blocks.map(block => ({ text: block.text, source: "current" as const })),
      ...history.slice(0, 40).map(entry => ({ text: entry.originalPrompt, source: "history" as const }))
    ];

    const grouped = new Map<string, { prefix: string; samples: readonly { text: string; source: "current" | "history" }[] }>();
    for (const sample of samples) {
      const prefix = this.prefixFor(sample.text);
      if (!prefix) {
        continue;
      }

      const key = prefix.toLowerCase();
      const current = grouped.get(key);
      if (!current) {
        grouped.set(key, { prefix, samples: [sample] });
      } else {
        grouped.set(key, { prefix: current.prefix, samples: [...current.samples, sample] });
      }
    }

    return [...grouped.values()]
      .map(group => this.suggestionForGroup(group.prefix, group.samples))
      .filter((suggestion): suggestion is TemplatePrefixSuggestion => Boolean(suggestion))
      .sort((left, right) => right.occurrences - left.occurrences || right.estimatedSavingsTokens - left.estimatedSavingsTokens)
      .slice(0, 6);
  }

  private suggestionForGroup(prefix: string, samples: readonly { text: string; source: "current" | "history" }[]): TemplatePrefixSuggestion | undefined {
    if (samples.length < 2) {
      return undefined;
    }

    const sharedPrefix = this.sharedPrefix(samples.map(sample => sample.text)) || prefix;
    const currentOccurrences = samples.filter(sample => sample.source === "current").length;
    const historyOccurrences = samples.length - currentOccurrences;
    const tokens = this.tokenCount(sharedPrefix);
    if (tokens < 4 && sharedPrefix.length < 24) {
      return undefined;
    }

    const variables = ["details"];
    const templatePreview = sharedPrefix.endsWith(":") || sharedPrefix.endsWith("-") ? sharedPrefix : `${sharedPrefix}\n\n`;
    const estimatedSavingsTokens = Math.max(0, Math.round(tokens * Math.max(1, samples.length - 1) * 0.6));
    const examples = samples.slice(0, 3).map(sample => sample.text.length > 120 ? `${sample.text.slice(0, 117)}...` : sample.text);

    return {
      prefix: sharedPrefix,
      occurrences: samples.length,
      currentOccurrences,
      historyOccurrences,
      estimatedSavingsTokens,
      templatePreview,
      snippetBody: `${templatePreview}\n\${1:details}`,
      variables,
      examples,
      reason: historyOccurrences > 0
        ? "This opening appears across history and can be reused as a shared template prefix."
        : "This opening is repeated within the current prompt and can be extracted into a reusable template prefix."
    };
  }

  private prefixFor(text: string): string | undefined {
    const firstLine = text.split(/\r?\n/).find(line => line.trim().length > 0) ?? text;
    const words = firstLine
      .match(/[\p{L}\p{N}_'-]+/gu)
      ?.slice(0, 8)
      .map(word => word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""))
      .filter(Boolean) ?? [];

    if (words.length < 4) {
      return undefined;
    }

    return words.join(" ");
  }

  private tokenCount(text: string): number {
    return text.match(/[\p{L}\p{N}_'-]+/gu)?.length ?? 0;
  }

  private sharedPrefix(samples: readonly string[]): string | undefined {
    if (!samples.length) {
      return undefined;
    }

    const tokenArrays = samples.map(sample => this.wordTokens(sample));
    const first = tokenArrays[0] ?? [];
    const rest = tokenArrays.slice(1);
    if (!first.length) {
      return undefined;
    }

    const prefix: string[] = [];
    for (let index = 0; index < first.length; index += 1) {
      const token = first[index];
      if (!token) {
        break;
      }
      if (rest.every(tokens => tokens[index]?.toLowerCase() === token.toLowerCase())) {
        prefix.push(token);
      } else {
        break;
      }
    }

    return prefix.join(" ");
  }

  private wordTokens(text: string): string[] {
    const firstLine = text.split(/\r?\n/).find(line => line.trim().length > 0) ?? text;
    return firstLine.match(/[\p{L}\p{N}_'-]+/gu)?.slice(0, 12) ?? [];
  }
}