import { describe, expect, it } from "vitest";
import { PromptDuplicateDetectionService } from "./promptDuplicateDetectionService";

describe("PromptDuplicateDetectionService", () => {
  it("detects similar semantic blocks and estimates savings", () => {
    const service = new PromptDuplicateDetectionService();
    const report = service.detect(`
Role: You are a precise editor.

Task: Rewrite the prompt to remove repeated ideas and keep it concise.

Task: Rewrite the prompt so repeated ideas are removed and the prompt stays concise.
`);

    expect(report.method).toBe("lightweight");
    expect(report.blockCount).toBeGreaterThanOrEqual(2);
    expect(report.matchCount).toBeGreaterThan(0);
    expect(report.matches[0]?.similarityPercent).toBeGreaterThanOrEqual(50);
    expect(report.matches[0]?.potentialSavingsTokens).toBeGreaterThan(0);
    expect(report.matches[0]?.mergeSuggestion).toContain("Merge");
  });
});