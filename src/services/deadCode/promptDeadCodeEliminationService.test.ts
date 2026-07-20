import { describe, expect, it } from "vitest";
import { PromptDeadCodeEliminationService } from "./promptDeadCodeEliminationService";

describe("PromptDeadCodeEliminationService", () => {
  it("estimates dead-code instructions and never recommends automatic removal", () => {
    const service = new PromptDeadCodeEliminationService();
    const report = service.analyze(`
You are an extremely helpful, very very important, highly critical assistant.

You are an extremely helpful, very very important, highly critical assistant.

This introduction is long and includes a lot of background that is not needed for the final answer.

Task: Rewrite the prompt to be concise and precise.

Context: This long background paragraph repeats itself and mostly adds redundant details that do not change the request.
`);

    expect(report.method).toBe("experimental");
    expect(report.findingCount).toBeGreaterThan(0);
    expect(report.estimatedTotalSavingsTokens).toBeGreaterThan(0);
    expect(report.findings[0]?.impact).toMatch(/critical|medium|low/);
    expect(report.findings[0]?.neverRemoveAutomatically).toBe(true);
  });
});