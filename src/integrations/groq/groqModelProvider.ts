import * as vscode from "vscode";
import { GroqClient, GroqMessage } from "./groqClient";

const model: vscode.LanguageModelChatInformation = { id: "gpt-oss-20b", name: "PromptGuard Groq · GPT-OSS 20B", family: "gpt-oss", version: "current", maxInputTokens: 120_000, maxOutputTokens: 8_000, capabilities: {} };
export class GroqModelProvider implements vscode.LanguageModelChatProvider {
  constructor(private readonly client = new GroqClient()) {}
  async provideLanguageModelChatInformation(options: { silent: boolean }, _token: vscode.CancellationToken): Promise<vscode.LanguageModelChatInformation[]> { return await this.client.isConfigured() ? [model] : []; }
  async provideLanguageModelChatResponse(_model: vscode.LanguageModelChatInformation, messages: readonly vscode.LanguageModelChatRequestMessage[], _options: vscode.ProvideLanguageModelChatResponseOptions, progress: vscode.Progress<vscode.LanguageModelResponsePart>, _token: vscode.CancellationToken): Promise<void> {
    const converted: GroqMessage[] = messages.map<GroqMessage>(message => ({ role: message.role === vscode.LanguageModelChatMessageRole.Assistant ? "assistant" : "user", content: message.content.filter((part): part is vscode.LanguageModelTextPart => part instanceof vscode.LanguageModelTextPart).map(part => part.value).join("") })).filter(message => message.content.length > 0);
    const answer = await this.client.completeMessages(converted, 1_500);
    progress.report(new vscode.LanguageModelTextPart(answer.content));
  }
  async provideTokenCount(_model: vscode.LanguageModelChatInformation, text: string | vscode.LanguageModelChatRequestMessage, _token: vscode.CancellationToken): Promise<number> { return Math.ceil((typeof text === "string" ? text : text.content.map(part => part instanceof vscode.LanguageModelTextPart ? part.value : "").join("")).length / 4); }
}
