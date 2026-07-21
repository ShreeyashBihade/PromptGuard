import * as fs from "fs";
import * as path from "path";
import { Category, PromptIssue } from "../../types";
import { PromptAnalyzer } from "../../analysis/promptAnalyzer";

export interface PromptBenchmarkCriterion {
  readonly id: string;
  readonly description: string;
  readonly minScore?: number;
  readonly maxScore?: number;
  readonly maxIssueCount?: number;
  readonly requiredRuleIds?: readonly string[];
  readonly forbiddenRuleIds?: readonly string[];
  readonly requiredCategories?: readonly Category[];
  readonly forbiddenCategories?: readonly Category[];
  readonly minTokenSavings?: number;
  readonly maxTokenSavings?: number;
}

export interface PromptBenchmarkCase {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly prompt: string;
  readonly disabledRules?: readonly string[];
  readonly criteria: readonly PromptBenchmarkCriterion[];
}

export interface PromptBenchmarkSuite {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly cases: readonly PromptBenchmarkCase[];
}

export interface PromptBenchmarkFile {
  readonly version: 1;
  readonly name?: string;
  readonly suites: readonly PromptBenchmarkSuite[];
}

export interface PromptBenchmarkCaseResult {
  readonly suiteId: string;
  readonly suiteName: string;
  readonly caseId: string;
  readonly caseName: string;
  readonly prompt: string;
  readonly score: number;
  readonly issueCount: number;
  readonly tokenSavings: number;
  readonly passed: boolean;
  readonly failures: readonly string[];
}

export interface PromptBenchmarkSuiteResult {
  readonly suiteId: string;
  readonly suiteName: string;
  readonly description?: string;
  readonly caseCount: number;
  readonly passedCount: number;
  readonly failedCount: number;
  readonly averageScore?: number;
  readonly cases: readonly PromptBenchmarkCaseResult[];
}

export interface PromptBenchmarkReport {
  readonly source?: string;
  readonly loaded: boolean;
  readonly suiteCount: number;
  readonly caseCount: number;
  readonly passedCount: number;
  readonly failedCount: number;
  readonly averageScore?: number;
  readonly suites: readonly PromptBenchmarkSuiteResult[];
}

const DEFAULT_BENCHMARK_FILE = "promptguard.benchmarks.json";

export class PromptBenchmarkService {
  private readonly analyzer = new PromptAnalyzer();
  private readonly cache = new Map<string, PromptBenchmarkFile>();

  constructor(private readonly workspaceRoot?: string, private readonly fileName = DEFAULT_BENCHMARK_FILE) {}

  load(): PromptBenchmarkFile | undefined {
    const benchmarkPath = this.benchmarkPath();
    if (!benchmarkPath) return undefined;
    const cached = this.cache.get(benchmarkPath);
    if (cached) return cached;
    if (!fs.existsSync(benchmarkPath)) return undefined;
    const parsed = this.parse(fs.readFileSync(benchmarkPath, "utf8"));
    if (!parsed) return undefined;
    this.cache.set(benchmarkPath, parsed);
    return parsed;
  }

  run(): PromptBenchmarkReport {
    const benchmarks = this.load();
    if (!benchmarks) return { loaded: false, suiteCount: 0, caseCount: 0, passedCount: 0, failedCount: 0, suites: [] };
    const suites = benchmarks.suites.map(suite => this.evaluateSuite(suite));
    const caseCount = suites.reduce((total, suite) => total + suite.caseCount, 0);
    const passedCount = suites.reduce((total, suite) => total + suite.passedCount, 0);
    const failedCount = caseCount - passedCount;
    const scoredCases = suites.flatMap(suite => suite.cases);
    const averageScore = scoredCases.length ? scoredCases.reduce((total, item) => total + item.score, 0) / scoredCases.length : undefined;
    return { source: this.benchmarkPath(), loaded: true, suiteCount: suites.length, caseCount, passedCount, failedCount, averageScore, suites };
  }

  clearCache(): void {
    this.cache.clear();
  }

  private evaluateSuite(suite: PromptBenchmarkSuite): PromptBenchmarkSuiteResult {
    const cases = suite.cases.map(testCase => this.evaluateCase(suite, testCase));
    const passedCount = cases.filter(testCase => testCase.passed).length;
    const caseCount = cases.length;
    const averageScore = caseCount ? cases.reduce((total, testCase) => total + testCase.score, 0) / caseCount : undefined;
    return { suiteId: suite.id, suiteName: suite.name, description: suite.description, caseCount, passedCount, failedCount: caseCount - passedCount, averageScore, cases };
  }

  private evaluateCase(suite: PromptBenchmarkSuite, testCase: PromptBenchmarkCase): PromptBenchmarkCaseResult {
    const analysis = this.analyzer.analyze(testCase.prompt, testCase.disabledRules ?? []);
    const failures: string[] = [];
    const issues = analysis.issues;
    const tokenSavings = analysis.optimization.estimatedTokenSavings ?? 0;
    for (const criterion of testCase.criteria) this.applyCriterionFailures(criterion, analysis.score.total, issues, tokenSavings, failures);
    return { suiteId: suite.id, suiteName: suite.name, caseId: testCase.id, caseName: testCase.name, prompt: testCase.prompt, score: analysis.score.total, issueCount: issues.length, tokenSavings, passed: failures.length === 0, failures };
  }

  private applyCriterionFailures(criterion: PromptBenchmarkCriterion, score: number, issues: readonly PromptIssue[], tokenSavings: number, failures: string[]): void {
    if (typeof criterion.minScore === "number" && score < criterion.minScore) failures.push(`${criterion.id}: score ${score} is below minimum ${criterion.minScore}.`);
    if (typeof criterion.maxScore === "number" && score > criterion.maxScore) failures.push(`${criterion.id}: score ${score} exceeds maximum ${criterion.maxScore}.`);
    if (typeof criterion.maxIssueCount === "number" && issues.length > criterion.maxIssueCount) failures.push(`${criterion.id}: issue count ${issues.length} exceeds maximum ${criterion.maxIssueCount}.`);
    if (typeof criterion.minTokenSavings === "number" && tokenSavings < criterion.minTokenSavings) failures.push(`${criterion.id}: token savings ${tokenSavings} is below minimum ${criterion.minTokenSavings}.`);
    if (typeof criterion.maxTokenSavings === "number" && tokenSavings > criterion.maxTokenSavings) failures.push(`${criterion.id}: token savings ${tokenSavings} exceeds maximum ${criterion.maxTokenSavings}.`);
    const issueRuleIds = new Set(issues.map(issue => issue.ruleId));
    const issueCategories = new Set(issues.map(issue => issue.category));
    for (const ruleId of criterion.requiredRuleIds ?? []) if (!issueRuleIds.has(ruleId)) failures.push(`${criterion.id}: expected rule ${ruleId} to be triggered.`);
    for (const ruleId of criterion.forbiddenRuleIds ?? []) if (issueRuleIds.has(ruleId)) failures.push(`${criterion.id}: rule ${ruleId} should not be triggered.`);
    for (const category of criterion.requiredCategories ?? []) if (!issueCategories.has(category)) failures.push(`${criterion.id}: expected category ${category} to be present.`);
    for (const category of criterion.forbiddenCategories ?? []) if (issueCategories.has(category)) failures.push(`${criterion.id}: category ${category} should not be present.`);
  }

  private benchmarkPath(): string | undefined {
    if (!this.workspaceRoot) return undefined;
    return path.join(this.workspaceRoot, this.fileName);
  }

  private parse(source: string): PromptBenchmarkFile | undefined {
    try {
      const value = JSON.parse(source) as Partial<PromptBenchmarkFile>;
      if (value.version !== 1 || !Array.isArray(value.suites)) return undefined;
      const suites = value.suites.filter((suite): suite is PromptBenchmarkSuite => typeof suite === "object" && suite !== null && typeof (suite as { id?: unknown }).id === "string" && typeof (suite as { name?: unknown }).name === "string" && Array.isArray((suite as { cases?: unknown }).cases)).map(suite => ({
        id: suite.id,
        name: suite.name,
        description: typeof suite.description === "string" ? suite.description : undefined,
        cases: suite.cases.filter((testCase): testCase is PromptBenchmarkCase => typeof testCase === "object" && testCase !== null && typeof (testCase as { id?: unknown }).id === "string" && typeof (testCase as { name?: unknown }).name === "string" && typeof (testCase as { prompt?: unknown }).prompt === "string" && Array.isArray((testCase as { criteria?: unknown }).criteria)).map(testCase => ({
          id: testCase.id,
          name: testCase.name,
          description: typeof testCase.description === "string" ? testCase.description : undefined,
          prompt: testCase.prompt,
          disabledRules: Array.isArray(testCase.disabledRules) ? testCase.disabledRules.filter((rule): rule is string => typeof rule === "string") : undefined,
          criteria: testCase.criteria.filter((criterion): criterion is PromptBenchmarkCriterion => typeof criterion === "object" && criterion !== null && typeof (criterion as { id?: unknown }).id === "string" && typeof (criterion as { description?: unknown }).description === "string").map(criterion => ({
            id: criterion.id,
            description: criterion.description,
            minScore: typeof criterion.minScore === "number" ? criterion.minScore : undefined,
            maxScore: typeof criterion.maxScore === "number" ? criterion.maxScore : undefined,
            maxIssueCount: typeof criterion.maxIssueCount === "number" ? criterion.maxIssueCount : undefined,
            requiredRuleIds: Array.isArray(criterion.requiredRuleIds) ? criterion.requiredRuleIds.filter((rule): rule is string => typeof rule === "string") : undefined,
            forbiddenRuleIds: Array.isArray(criterion.forbiddenRuleIds) ? criterion.forbiddenRuleIds.filter((rule): rule is string => typeof rule === "string") : undefined,
            requiredCategories: Array.isArray(criterion.requiredCategories) ? criterion.requiredCategories.filter((category): category is Category => this.isCategory(category)) : undefined,
            forbiddenCategories: Array.isArray(criterion.forbiddenCategories) ? criterion.forbiddenCategories.filter((category): category is Category => this.isCategory(category)) : undefined,
            minTokenSavings: typeof criterion.minTokenSavings === "number" ? criterion.minTokenSavings : undefined,
            maxTokenSavings: typeof criterion.maxTokenSavings === "number" ? criterion.maxTokenSavings : undefined
          }))
        }))
      }));
      return { version: 1, name: typeof value.name === "string" ? value.name : undefined, suites };
    } catch {
      return undefined;
    }
  }

  private isCategory(value: unknown): value is Category {
    return value === "context" || value === "specificity" || value === "constraints" || value === "examples" || value === "formatting" || value === "safety" || value === "efficiency" || value === "maintainability";
  }
}
