export interface ModelProvider { readonly id: string; optimize(prompt: string): Promise<string>; }
/** Future OpenAI/Anthropic/Gemini adapters implement this contract after explicit consent. */
export class LocalProvider implements ModelProvider { readonly id = "local"; async optimize(prompt: string): Promise<string> { return prompt; } }
