import { BaseRule } from "../analysis/rule";
import { PromptAstParser } from "../analysis/promptAstParser";
import { PromptIssue, RuleContext } from "../types";

const contains = (text: string, pattern: RegExp): boolean => pattern.test(text);
const isDynamicPlaceholder = (text: string): boolean => /\{\{[^}]+\}\}|\{[^}\n]{1,80}\}|\$\{[^}\n]{1,80}\}|<\s*\/?\s*[a-z][^>]{0,40}>/i.test(text);
const isStaticSection = (kind: string): boolean => ["role", "context", "task", "constraints", "examples", "output-format", "notes", "metadata"].includes(kind);
const isSectionHeading = (text: string): boolean => /^(#{1,6}\s+|(?:role|context|background|task|objective|goal|instructions|constraints|constraint|examples?|example|output format|output|format|schema|notes?|metadata|meta)\s*[:\-])/i.test(text.trim());

abstract class AstAwareRule extends BaseRule {
	protected readonly astParser = new PromptAstParser();
}

export class PromptCachingStructureRule extends AstAwareRule {
	readonly id = "prompt-caching-structure";
	readonly category = "efficiency" as const;

	analyze(context: RuleContext): PromptIssue[] {
		const lines = context.prompt.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
		const firstDynamicIndex = lines.findIndex(isDynamicPlaceholder);
		const firstStaticIndex = lines.findIndex(isSectionHeading);
		if (firstDynamicIndex >= 0 && firstStaticIndex >= 0 && firstDynamicIndex < firstStaticIndex) {
			const ast = this.astParser.parse(context.prompt);
			const staticTokens = ast.children.filter(node => isStaticSection(node.kind)).reduce((sum, node) => sum + node.tokenCount, 0);
			const savings = Math.max(0, Math.round(staticTokens * 0.55));
			const offending = ast.children.find(node => isDynamicPlaceholder(node.text) || node.lineStart === firstDynamicIndex + 1);
			return [this.issue("Prompt caching structure", "Dynamic placeholders appear before static instructions. This reduces cache-friendly structure for repeated prompt bodies.", "warning", "Move system instructions, rigid rules, and static templates above variables, then keep dynamic placeholders at the bottom.", savings, offending?.lineStart, offending?.lineEnd)];
		}
		return [];
	}
}

export class FewShotExamplePrunerRule extends AstAwareRule {
	readonly id = "few-shot-example-pruner";
	readonly category = "examples" as const;

	analyze(context: RuleContext): PromptIssue[] {
		const ast = this.astParser.parse(context.prompt);
		const blocks = ast.children.filter(node => node.text.trim().length > 0);
		const exampleBlocks = blocks.filter(node => node.kind === "examples" || /\b(input|output|q|a|user|assistant)\s*[:>\-]/i.test(node.text) || /\bexample\b/i.test(node.text));
		if (!exampleBlocks.length) return [];

		const exampleTokens = exampleBlocks.reduce((sum, node) => sum + node.tokenCount, 0);
		const totalTokens = Math.max(1, blocks.reduce((sum, node) => sum + node.tokenCount, 0));
		const overBudget = (exampleTokens / totalTokens) > 0.4 || exampleBlocks.length > 3;
		if (!overBudget) return [];

		const keepCount = Math.min(3, exampleBlocks.length);
		const savings = Math.max(0, exampleBlocks.slice(keepCount).reduce((sum, node) => sum + node.tokenCount, 0));
		const first = exampleBlocks[keepCount] ?? exampleBlocks[0];
		return [this.issue("Bloated few-shot examples", "Example blocks are consuming too much of the prompt and are likely inflating token cost.", "warning", `Keep only the first ${keepCount} examples and remove the rest. The token and dollar savings will show in the simulator.`, savings, first?.lineStart, first?.lineEnd)];
	}
}

export class ConversationalTransitionStripperRule extends AstAwareRule {
	readonly id = "conversational-transition-stripper";
	readonly category = "efficiency" as const;

	analyze(context: RuleContext): PromptIssue[] {
		const ast = this.astParser.parse(context.prompt);
		const blocks = ast.children.filter(node => node.text.trim().length > 0);
		for (let index = 0; index < blocks.length - 1; index += 1) {
			const current = blocks[index]!;
			const next = blocks[index + 1];
			if (!next) continue;
			const filler = current.text.trim();
			const followsStructuralDivider = /^#{1,6}\s|^<\/?[a-z][^>]*>/i.test(next.text.trim());
			const conversationalLeadIn = /^(in the section below|please pay attention to the following guidelines|in this prompt|below i will provide|i will provide|please note that|kindly note that)[\s:,.-]/i.test(filler);
			if (followsStructuralDivider && conversationalLeadIn) {
				const savings = Math.max(1, current.tokenCount);
				return [this.issue("Conversational transition text", "A wordy lead-in precedes a structural divider and can be removed without losing meaning.", "info", "Replace the filler sentence with a direct markdown header or compact XML section heading.", savings, current.lineStart, current.lineEnd)];
			}
		}
		return [];
	}
}

export class ImperativeStopWordOptimizerRule extends AstAwareRule {
	readonly id = "imperative-stop-word-optimizer";
	readonly category = "maintainability" as const;

	analyze(context: RuleContext): PromptIssue[] {
		const match = /\b(?:please ensure that you do|kindly try to|it is highly recommended to|would you mind writing|please try to|please do|kindly do)\b/i.exec(context.prompt);
		if (!match) return [];
		const replacement = this.rewrite(match[0]);
		const savings = Math.max(1, Math.round(match[0].split(/\s+/).length - replacement.split(/\s+/).length));
		return [this.issue("Polite stop-word overload", `“${match[0]}” can be tightened into a direct imperative without changing intent.`, "info", replacement, savings, match.index, match.index + match[0].length)];
	}

	private rewrite(text: string): string {
		const normalized = text.toLowerCase();
		if (normalized.includes("please ensure that you do")) return "Ensure you do";
		if (normalized.includes("kindly try to")) return "Try to";
		if (normalized.includes("it is highly recommended to")) return "Do";
		if (normalized.includes("would you mind writing")) return "Write";
		if (normalized.includes("please try to")) return "Try to";
		if (normalized.includes("please do")) return "Do";
		if (normalized.includes("kindly do")) return "Do";
		return "Do";
	}
}

export class MissingRoleRule extends BaseRule {
	readonly id = "missing-role";
	readonly category = "context" as const;
	analyze(context: RuleContext): PromptIssue[] {
		return contains(context.prompt, /\b(act as|you are|as a)\b/i) ? [] : [this.issue("Missing role definition", "The model has no explicit perspective or expertise to adopt.", "warning", "Start with a role, such as ‘You are a senior technical writer.’")];
	}
}

export class MissingTaskRule extends BaseRule {
	readonly id = "missing-task";
	readonly category = "context" as const;
	analyze(context: RuleContext): PromptIssue[] {
		return contains(context.prompt, /\b(task|objective|goal)\b/i) || contains(context.prompt, /\b(write|create|draft|build|generate|analyze|summarize|design|explain|implement|compare|validate|produce|return)\b/i) ? [] : [this.issue("Missing task", "The prompt does not clearly state what the model should do.", "warning", "State the task explicitly, for example: ‘Task: summarize the article in three bullets.’")];
	}
}

export class LongContextRule extends BaseRule {
	readonly id = "long-context";
	readonly category = "efficiency" as const;
	analyze(context: RuleContext): PromptIssue[] {
		return context.prompt.trim().length > 1600 || context.words.length > 260 ? [this.issue("Long context", "The prompt is very long and likely contains background that can be shortened.", "info", "Summarize background, move details into bullets, and keep only the necessary context.")] : [];
	}
}

export class PassiveVoiceRule extends BaseRule {
	readonly id = "passive-voice";
	readonly category = "maintainability" as const;
	analyze(context: RuleContext): PromptIssue[] {
		const match = /\b(?:is|are|was|were|be|been|being)\s+(?:\w+ed|\w+en|required|allowed|included|given|made|done)\b/i.exec(context.prompt);
		return match ? [this.issue("Passive voice", `“${match[0]}” is phrased passively and can hide the actor.`, "info", "Rewrite in active voice and name the actor or action directly.", 0, match.index, match.index + match[0].length)] : [];
	}
}

export class TooManyExamplesRule extends BaseRule {
	readonly id = "too-many-examples";
	readonly category = "examples" as const;
	analyze(context: RuleContext): PromptIssue[] {
		const matches = context.prompt.match(/\b(example|examples|input:|output:|e\.g\.|for instance)\b/gi) ?? [];
		return matches.length > 3 ? [this.issue("Too many examples", "The prompt includes several examples and may be over-specified.", "info", "Keep one or two concise examples and remove the rest.")] : [];
	}
}

export class MissingOutputRule extends BaseRule {
	readonly id = "missing-output-format";
	readonly category = "formatting" as const;
	analyze(context: RuleContext): PromptIssue[] {
		return contains(context.prompt, /\b(json|table|markdown|bullet|format|structure|schema)\b/i) ? [] : [this.issue("No output format", "Expected output is not structured, making responses less predictable.", "warning", "Specify a format: headings, bullets, table, JSON schema, or word limit.")];
	}
}

export class AmbiguityRule extends BaseRule {
	readonly id = "ambiguous-language";
	readonly category = "specificity" as const;
	analyze(context: RuleContext): PromptIssue[] {
		const match = /\b(nice|good|better|appropriate|quickly|some|things|etc\.?|maybe)\b/i.exec(context.prompt);
		return match ? [this.issue("Ambiguous wording", `“${match[0]}” is subjective and leaves room for interpretation.`, "warning", "Replace subjective terms with measurable requirements.", 0, match.index, match.index + match[0].length)] : [];
	}
}

export class WeakVerbRule extends BaseRule {
	readonly id = "weak-verbs";
	readonly category = "specificity" as const;
	analyze(context: RuleContext): PromptIssue[] {
		const match = /\b(help|handle|do|make|fix|improve)\b/i.exec(context.prompt);
		return match ? [this.issue("Weak instruction verb", `“${match[0]}” does not precisely describe the requested outcome.`, "info", "Use a precise verb such as analyze, compare, draft, classify, or validate.", 0, match.index, match.index + match[0].length)] : [];
	}
}

export class RepetitionRule extends BaseRule {
	readonly id = "repeated-information";
	readonly category = "efficiency" as const;
	analyze(context: RuleContext): PromptIssue[] {
		const seen = new Set<string>();
		const repeated = context.words.find(word => word.length > 5 && (seen.has(word.toLowerCase()) || !seen.add(word.toLowerCase())));
		return repeated ? [this.issue("Potential repetition", `“${repeated}” appears more than once and may be redundant.`, "info", "Remove duplicated context unless repetition is intentional.", 4)] : [];
	}
}

export class MissingConstraintsRule extends BaseRule {
	readonly id = "missing-constraints";
	readonly category = "constraints" as const;
	analyze(context: RuleContext): PromptIssue[] {
		return contains(context.prompt, /\b(must|must not|only|limit|avoid|under|at most)\b/i) ? [] : [this.issue("No constraints", "No boundaries were found for scope, length, tone, or exclusions.", "warning", "Add explicit constraints, e.g. audience, length, scope, and exclusions.")];
	}
}

export class MissingExamplesRule extends BaseRule {
	readonly id = "missing-examples";
	readonly category = "examples" as const;
	analyze(context: RuleContext): PromptIssue[] {
		return contains(context.prompt, /\b(example|e\.g\.|for instance|input:|output:)\b/i) ? [] : [this.issue("Missing examples", "Examples can substantially improve consistency for nuanced tasks.", "info", "Add one concise input/output example for complex or style-sensitive tasks.")];
	}
}

export class SafetyRule extends BaseRule {
	readonly id = "prompt-injection";
	readonly category = "safety" as const;
	analyze(context: RuleContext): PromptIssue[] {
		const match = /\b(ignore (previous|all)|reveal (your|the) instructions|system prompt|bypass)\b/i.exec(context.prompt);
		return match ? [this.issue("Prompt injection patterns", "This text resembles an instruction-override attempt.", "error", "Remove instruction-override language and isolate untrusted content.", 0, match.index, match.index + match[0].length)] : [];
	}
}

export class SecretRule extends BaseRule {
	readonly id = "secret-leakage";
	readonly category = "safety" as const;
	analyze(context: RuleContext): PromptIssue[] {
		const match = /(sk-[A-Za-z0-9_-]{12,}|AKIA[0-9A-Z]{16}|-----BEGIN (?:RSA |OPENSSH )?PRIVATE KEY-----)/.exec(context.prompt);
		return match ? [this.issue("Unsafe secret detected", "The prompt appears to contain credential material.", "error", "Remove and rotate the secret; reference it through a secure mechanism instead.", 0, match.index, match.index + match[0].length)] : [];
	}
}

export class PiiRule extends BaseRule {
	readonly id = "pii-detection";
	readonly category = "safety" as const;
	analyze(context: RuleContext): PromptIssue[] {
		const match = /\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b|\b(?:\d[ -]*?){13,16}\b/.exec(context.prompt);
		return match ? [this.issue("PII detected", "The prompt contains an email address or payment-card-like number.", "warning", "Redact or tokenize personal data before sending it to a model.", 0, match.index, match.index + match[0].length)] : [];
	}
}

export const builtinRules = [MissingRoleRule, MissingTaskRule, LongContextRule, PassiveVoiceRule, TooManyExamplesRule, MissingOutputRule, AmbiguityRule, WeakVerbRule, RepetitionRule, MissingConstraintsRule, MissingExamplesRule, SafetyRule, SecretRule, PiiRule, PromptCachingStructureRule, FewShotExamplePrunerRule, ConversationalTransitionStripperRule, ImperativeStopWordOptimizerRule];
