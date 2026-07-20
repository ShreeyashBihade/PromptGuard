import { describe, expect, it, vi } from "vitest";
import { GroqGateway } from "./groqGateway";
import { GroqClient, GroqCompletion } from "./groqClient";

vi.mock("vscode", () => ({
  workspace: { workspaceFolders: [] }
}));

class FakeGroqClient extends GroqClient {
  private readonly replies: GroqCompletion[];

  constructor(replies: GroqCompletion[]) {
    super();
    this.replies = [...replies];
  }

  override async isConfigured(): Promise<boolean> {
    return true;
  }

  override async complete(_system: string, _prompt: string, _maxTokens: number): Promise<GroqCompletion> {
    const next = this.replies.shift();
    if (!next) throw new Error("No fake Groq response queued.");
    return next;
  }
}

const completion = (content: string, promptTokens = 100, completionTokens = 40): GroqCompletion => ({
  content,
  usage: { promptTokens, completionTokens }
});

describe("GroqGateway token optimizer", () => {
  it("accepts a valid preservation JSON result for compress mode", async () => {
    const client = new FakeGroqClient([
      completion('{"optimizedPrompt":"Write a concise changelog with bullet points.","changeSummary":["Removed filler"],"preservationCheck":{"intentPreserved":true,"constraintsPreserved":true,"contextPreserved":true}}')
    ]);
    const gateway = new GroqGateway(client);

    const result = await gateway.improveWithContext(
      "Please can you kindly write a concise changelog with bullet points.",
      "None",
      [],
      "compress"
    );

    expect(result.improvedPrompt).toBe("Write a concise changelog with bullet points.");
    expect(result.outputTokens).toBe(40);
    expect(result.costUsd).toBeGreaterThan(0);
  });

  it("retries once and accepts second valid JSON result", async () => {
    const client = new FakeGroqClient([
      completion('{"optimizedPrompt":"x","changeSummary":[],"preservationCheck":{"intentPreserved":false,"constraintsPreserved":true,"contextPreserved":true}}', 100, 20),
      completion('{"optimizedPrompt":"Generate test cases for login and logout flows.","changeSummary":["Compressed wording"],"preservationCheck":{"intentPreserved":true,"constraintsPreserved":true,"contextPreserved":true}}', 100, 30)
    ]);
    const gateway = new GroqGateway(client);

    const result = await gateway.improveWithContext(
      "Please generate test cases for login and logout flows in detail.",
      "None",
      [],
      "compress"
    );

    expect(result.improvedPrompt).toBe("Generate test cases for login and logout flows.");
    expect(result.outputTokens).toBe(50);
  });
});
