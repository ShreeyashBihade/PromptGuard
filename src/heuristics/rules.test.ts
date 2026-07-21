import { describe, expect, it } from "vitest";
import { ConversationalTransitionStripperRule, FewShotExamplePrunerRule, ImperativeStopWordOptimizerRule, PromptCachingStructureRule } from "./rules";

const baseContext = {
  prompt: "",
  metadata: {}
} as any;

describe("Prompt heuristic rules", () => {
  it("flags dynamic placeholders before static instructions", () => {
    const rule = new PromptCachingStructureRule();
    const issues = rule.analyze({ ...baseContext, prompt: "{{customer_name}}\n\nRole: You are a concise editor.\n\nTask: Rewrite the text." });

    expect(issues).toHaveLength(1);
    expect(issues[0]?.ruleId).toBe("prompt-caching-structure");
    expect(issues[0]?.suggestedFix).toContain("Move system instructions");
  });

  it("suggests pruning excess few-shot examples", () => {
    const rule = new FewShotExamplePrunerRule();
    const issues = rule.analyze({ ...baseContext, prompt: [
      "Example 1: Input A -> Output A",
      "Example 2: Input B -> Output B",
      "Example 3: Input C -> Output C",
      "Example 4: Input D -> Output D"
    ].join("\n\n") });

    expect(issues).toHaveLength(1);
    expect(issues[0]?.ruleId).toBe("few-shot-example-pruner");
  });

  it("flags conversational filler before structural sections", () => {
    const rule = new ConversationalTransitionStripperRule();
    const issues = rule.analyze({ ...baseContext, prompt: "Please note that the next section contains instructions.\n\n### Instructions\nDo the work." });

    expect(issues).toHaveLength(1);
    expect(issues[0]?.ruleId).toBe("conversational-transition-stripper");
  });

  it("tightens polite imperative phrasing", () => {
    const rule = new ImperativeStopWordOptimizerRule();
    const issues = rule.analyze({ ...baseContext, prompt: "Please ensure that you do keep the answer short." });

    expect(issues).toHaveLength(1);
    expect(issues[0]?.suggestedFix).toBe("Ensure you do");
  });
});