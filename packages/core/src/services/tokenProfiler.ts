import { LocalTelemetryClient, TelemetryClient } from "../telemetry/telemetry";
import { LiveTokenPricing } from "../config/settings";
import { PromptAstDocument, PromptAstNode } from "../analysis/promptAst";
import { PromptAstParser } from "../analysis/promptAstParser";

export interface TokenProfileSection {
  kind: PromptAstNode["kind"];
  label: string;
  text: string;
  tokenCount: number;
  importance: number;
  ambiguityScore: number;
  duplicateScore: number;
  lineStart: number;
  lineEnd: number;
  estimatedInputCostUsd: number;
  estimatedOutputCostUsd: number;
  potentialSavingsTokens: number;
  children: TokenProfileSection[];
  cached: boolean;
}

export interface TokenProfileReport {
  documentUri?: string;
  documentVersion?: number;
  updatedAt: string;
  totalTokens: number;
  sections: TokenProfileSection[];
  estimatedInputCostUsd: number;
  estimatedOutputCostUsd: number;
  latencyMs: number;
  mostExpensiveSection?: TokenProfileSection;
  potentialSavingsTokens: number;
  potentialSavingsUsd: number;
  cacheHits: number;
  cacheMisses: number;
}

export interface TokenProfilerInput {
  text: string;
  uri?: string;
  version?: number;
  pricing?: LiveTokenPricing;
}

export class TokenProfilerService {
  private readonly parser = new PromptAstParser();
  private readonly sectionCache = new Map<string, Omit<TokenProfileSection, "cached"> & { children?: TokenProfileSection[] }>();
  private readonly reportCache = new Map<string, TokenProfileReport>();

  constructor(private readonly telemetry: TelemetryClient = new LocalTelemetryClient()) {}

  profile(input: TokenProfilerInput): TokenProfileReport {
    const cacheKey = input.uri ? `${input.uri}::${input.version ?? 0}` : undefined;
    if (cacheKey) {
      const cached = this.reportCache.get(cacheKey);
      if (cached) {
        this.telemetry.emit("promptguard.tokenProfiler.reportCacheHit", { uri: input.uri ?? "", version: String(input.version ?? 0) });
        return cached;
      }
    }

    const ast = this.parser.parse(input.text);
    const pricing = input.pricing ?? { inputPerMillionUsd: 0.075, outputPerMillionUsd: 0.30 };
    let cacheHits = 0;
    let cacheMisses = 0;

    const sections = ast.children.map(node => this.profileNode(node, pricing, { cacheHits: () => { cacheHits += 1; }, cacheMisses: () => { cacheMisses += 1; } }));
    const totalTokens = this.estimateTokens(input.text);
    const estimatedOutputTokens = Math.max(64, Math.ceil(totalTokens * 0.5));
    const estimatedInputCostUsd = totalTokens * pricing.inputPerMillionUsd / 1_000_000;
    const estimatedOutputCostUsd = estimatedOutputTokens * pricing.outputPerMillionUsd / 1_000_000;
    const potentialSavingsTokens = sections.reduce((sum, section) => sum + section.potentialSavingsTokens, 0);
    const potentialSavingsUsd = potentialSavingsTokens * pricing.inputPerMillionUsd / 1_000_000;
    const mostExpensiveSection = sections.reduce<TokenProfileSection | undefined>((winner, section) => {
      if (!winner) return section;
      const winnerCost = winner.estimatedInputCostUsd + winner.estimatedOutputCostUsd;
      const sectionCost = section.estimatedInputCostUsd + section.estimatedOutputCostUsd;
      return sectionCost > winnerCost ? section : winner;
    }, undefined);

    const report: TokenProfileReport = {
      documentUri: input.uri,
      documentVersion: input.version,
      updatedAt: new Date().toISOString(),
      totalTokens,
      sections,
      estimatedInputCostUsd,
      estimatedOutputCostUsd,
      latencyMs: this.estimateLatency(totalTokens, sections.length),
      mostExpensiveSection,
      potentialSavingsTokens,
      potentialSavingsUsd,
      cacheHits,
      cacheMisses
    };

    if (cacheKey) this.reportCache.set(cacheKey, report);

    this.telemetry.emit("promptguard.tokenProfiler.profiled", { uri: input.uri ?? "", version: String(input.version ?? 0), totalTokens: String(totalTokens), sectionCount: String(sections.length), cacheHits: String(cacheHits), cacheMisses: String(cacheMisses), latencyMs: String(report.latencyMs) });
    return report;
  }

  private profileNode(node: PromptAstNode, pricing: LiveTokenPricing, cache: { cacheHits(): void; cacheMisses(): void }): TokenProfileSection {
    const key = this.nodeKey(node);
    const cached = this.sectionCache.get(key);
    if (cached) {
      cache.cacheHits();
      return { ...cached, cached: true, children: node.children.map(child => this.profileNode(child, pricing, cache)) };
    }

    cache.cacheMisses();
    const children = node.children.map(child => this.profileNode(child, pricing, cache));
    const tokenCount = this.estimateTokens(node.text);
    const estimatedInputCostUsd = tokenCount * pricing.inputPerMillionUsd / 1_000_000;
    const estimatedOutputCostUsd = Math.max(32, Math.ceil(tokenCount * 0.45)) * pricing.outputPerMillionUsd / 1_000_000;
    const potentialSavingsTokens = this.estimatePotentialSavings(node);
    const section: TokenProfileSection = { kind: node.kind, label: this.labelFor(node), text: node.text, tokenCount, importance: node.importance, ambiguityScore: node.ambiguityScore, duplicateScore: node.duplicateScore, lineStart: node.lineStart, lineEnd: node.lineEnd, estimatedInputCostUsd, estimatedOutputCostUsd, potentialSavingsTokens, children, cached: false };
    this.sectionCache.set(key, { ...section, children: [] });
    return section;
  }

  private nodeKey(node: PromptAstNode): string {
    return `${node.kind}:${this.normalize(node.text)}`;
  }

  private labelFor(node: PromptAstNode): string {
    switch (node.kind) {
      case "output-format": return "Output format";
      case "task": return "Task";
      case "constraints": return "Constraints";
      case "examples": return "Examples";
      case "metadata": return "Metadata";
      case "role": return "Role";
      case "context": return "Context";
      case "notes": return "Notes";
      case "paragraph": return `Paragraph ${node.lineStart}`;
      case "bullet": return `Bullet ${node.lineStart}`;
      default: return node.kind;
    }
  }

  private estimatePotentialSavings(node: PromptAstNode): number {
    const ambiguityLift = Math.round(node.tokenCount * (node.ambiguityScore / 100) * 0.18);
    const duplicateLift = Math.round(node.tokenCount * (node.duplicateScore / 100) * 0.4);
    const lowImportanceLift = node.importance < 45 ? Math.round(node.tokenCount * 0.12) : 0;
    return Math.max(0, ambiguityLift + duplicateLift + lowImportanceLift);
  }

  private estimateTokens(text: string): number {
    const words = text.trim() ? text.trim().split(/\s+/).length : 0;
    return Math.max(0, Math.ceil(Math.max(text.length / 6, words * 1.15)));
  }

  private estimateLatency(tokens: number, sections: number): number {
    return 160 + Math.round(tokens * 1.1) + sections * 14;
  }

  private normalize(text: string): string {
    return text.replace(/\s+/g, " ").trim().toLowerCase();
  }
}
