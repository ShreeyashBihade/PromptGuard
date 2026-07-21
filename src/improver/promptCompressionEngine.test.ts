import { describe, expect, it, vi } from "vitest";

vi.mock("vscode", () => ({
  workspace: {
    getConfiguration: () => ({
      get: (_key: string, defaultValue: unknown) => defaultValue
    })
  }
}));
import { PromptCompressionEngine } from "./promptCompressionEngine";

describe("PromptCompressionEngine", () => {
  it("compresses filler and repeated lines with a diff summary", () => {
    const engine = new PromptCompressionEngine();
    const preview = engine.compress(`Please, please create a concise summary.

Task: create a concise summary.
Task: create a concise summary.

Output format: markdown.`);

    expect(preview.optimizedPrompt.length).toBeLessThan(200);
    expect(preview.estimatedTokenSavings).toBeGreaterThanOrEqual(0);
    expect(preview.confidence).toBeGreaterThanOrEqual(0);
    expect(preview.diff).toContain("-");
    expect(preview.steps.length).toBeGreaterThanOrEqual(0);
  });

  it("replaces hedging phrases and collapses repeated constraints", () => {
    const engine = new PromptCompressionEngine();
    const preview = engine.compress(`Please make sure you should keep it concise.
You should keep it concise.
Constraints: keep it short.
Constraints: keep it short.
Explain the result in plain language.`);

    expect(preview.optimizedPrompt).toContain("Must keep it concise.");
    expect(preview.optimizedPrompt).not.toContain("Please make sure");
    expect(preview.optimizedPrompt).not.toContain("You should");
    expect(preview.optimizedPrompt.split(/\r?\n/).filter(line => line.startsWith("Constraints:")).length).toBe(1);
    expect(preview.reason).toContain("Replace");
    expect(preview.steps.some(step => step.label === "Collapse repeated constraints")).toBe(true);
  });

  it("applies the broader minimize filters", () => {
    const engine = new PromptCompressionEngine();
    const preview = engine.compress(`{{customer_name}}

Please note that the next section contains instructions.

### Instructions
Please ensure that you do keep the answer short.

Example 1: Input A -> Output A

Example 2: Input B -> Output B

Example 3: Input C -> Output C

Example 4: Input D -> Output D`);

    expect(preview.optimizedPrompt).not.toContain("Please note that");
    expect(preview.optimizedPrompt).not.toContain("Example 4");
    expect(preview.steps.some(step => step.label === "Reorder static before variables")).toBe(true);
    expect(preview.steps.some(step => step.label === "Prune few-shot examples")).toBe(true);
    expect(preview.steps.some(step => step.label === "Optimize imperatives")).toBe(true);
  });

});
