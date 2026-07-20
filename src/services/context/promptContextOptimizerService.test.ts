import { describe, expect, it } from "vitest";
import { PromptContextOptimizerService } from "./promptContextOptimizerService";

describe("PromptContextOptimizerService", () => {
  it("suggests removable context paragraphs and estimates savings", () => {
    const service = new PromptContextOptimizerService();
    const report = service.optimize(`
Role: You are a precise technical editor.

Task: Rewrite the prompt to focus on the final answer.

Background: This product launched in 2021, has a long history, and includes several unrelated implementation details that are not needed for the rewrite.

Notes: The user's team previously used a different system and mentioned a few organizational facts that do not affect the output.

Constraints: Keep the rewritten prompt concise and faithful.
`);

    expect(report.method).toBe("lightweight");
    expect(report.blockCount).toBeGreaterThanOrEqual(3);
    expect(report.suggestionCount).toBeGreaterThan(0);
    expect(report.suggestions[0]?.removableTokens).toBeGreaterThan(0);
    expect(report.suggestions[0]?.removeSuggestion).toContain("Remove");
    expect(report.suggestions[0]?.keepHint).toContain("Keep");
  });
});