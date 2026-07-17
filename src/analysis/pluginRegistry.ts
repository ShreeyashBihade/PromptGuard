import { PromptRule, RulePlugin } from "../types";
export class PluginRegistry {
  private readonly plugins: RulePlugin[] = [];
  register(plugin: RulePlugin): void { if (this.plugins.some(candidate => candidate.name === plugin.name)) throw new Error(`PromptGuard plugin already registered: ${plugin.name}`); this.plugins.push(plugin); }
  rules(): PromptRule[] { return this.plugins.flatMap(plugin => plugin.rules); }
}
