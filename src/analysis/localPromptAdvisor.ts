import { LocalInsights, ModelRecommendation } from "../types";

interface ModelProfile {
  provider: ModelRecommendation["provider"];
  model: string;
  strengths: string[];
  weakness: string;
}

const MODEL_CATALOG: readonly ModelProfile[] = [
  { provider: "groq", model: "llama-3.3-70b-versatile", strengths: ["reasoning", "analysis", "code"], weakness: "not the cheapest option" },
  { provider: "groq", model: "llama-3.1-8b-instant", strengths: ["speed", "cost", "short-rewrites"], weakness: "weaker for deep reasoning" },
  { provider: "groq", model: "mixtral-8x7b-32768", strengths: ["instruction-following", "long context", "multi-step editing"], weakness: "less consistent than top-tier models" },

  { provider: "openai", model: "gpt-4.1", strengths: ["reasoning", "code", "tool-use"], weakness: "higher cost tier" },
  { provider: "openai", model: "gpt-4.1-mini", strengths: ["balanced quality", "cost", "prompt rewriting"], weakness: "less depth on complex planning" },
  { provider: "openai", model: "gpt-4o", strengths: ["multimodal", "general-purpose", "chat quality"], weakness: "can be verbose without constraints" },

  { provider: "claude", model: "claude-3.5-sonnet", strengths: ["code quality", "structured writing", "instruction precision"], weakness: "latency can be higher than small models" },
  { provider: "claude", model: "claude-3-opus", strengths: ["deep analysis", "complex reasoning", "long-form strategy"], weakness: "expensive for high volume" },
  { provider: "claude", model: "claude-3-haiku", strengths: ["speed", "summaries", "cheap iterations"], weakness: "limited depth for difficult tasks" },

  { provider: "gemini", model: "gemini-1.5-pro", strengths: ["long context", "analysis", "multimodal"], weakness: "can require tighter formatting instructions" },
  { provider: "gemini", model: "gemini-1.5-flash", strengths: ["speed", "cost", "rapid prompt tests"], weakness: "less detailed outputs on complex asks" },
  { provider: "gemini", model: "gemini-1.0-pro", strengths: ["general-purpose", "stable responses", "chat"], weakness: "older generation quality ceiling" }
];

export class LocalPromptAdvisor {
  build(prompt: string, mode: LocalInsights["mode"]): LocalInsights {
    const task = this.detectTask(prompt);
    return {
      mode,
      bestPractices: this.bestPractices(prompt, task),
      recommendations: this.recommend(task)
    };
  }

  private detectTask(prompt: string): "code" | "creative" | "analysis" | "summarization" | "long-context" {
    const value = prompt.toLowerCase();
    if (/(refactor|typescript|python|bug|stack trace|function|class|compile|test|code)/.test(value)) return "code";
    if (/(summarize|summary|tl;dr|shorten|compress)/.test(value)) return "summarization";
    if (/(story|marketing|copy|brand|social post|creative)/.test(value)) return "creative";
    if (/(document|contract|policy|transcript|long|large context|many files|multiple files)/.test(value)) return "long-context";
    return "analysis";
  }

  private bestPractices(prompt: string, task: ReturnType<LocalPromptAdvisor["detectTask"]>): string[] {
    const practices = [
      "State the output format explicitly (table, JSON, bullet list, or checklist).",
      "Add acceptance criteria so the model can self-check before finalizing.",
      "Include constraints (token budget, style, must-include and must-avoid items)."
    ];

    if (prompt.length < 120) practices.unshift("Provide more context about audience, objective, and edge cases.");
    if (!/example|sample|input|output/i.test(prompt)) practices.push("Include one good example input/output pair for stronger consistency.");

    if (task === "code") practices.push("Mention runtime/language version and how the result will be tested.");
    if (task === "creative") practices.push("Specify tone, brand voice, and no-go phrases to avoid generic output.");
    if (task === "summarization") practices.push("Ask for key points + action items + confidence notes to reduce hallucination risk.");
    if (task === "long-context") practices.push("Chunk long material and request section-by-section reasoning before final synthesis.");

    return practices.slice(0, 6);
  }

  private recommend(task: ReturnType<LocalPromptAdvisor["detectTask"]>): ModelRecommendation[] {
    const ranked = MODEL_CATALOG.map(profile => {
      const score = profile.strengths.includes(task === "long-context" ? "long context" : task)
        ? 3
        : profile.strengths.includes("analysis") && task === "analysis"
          ? 2
          : profile.strengths.includes("general-purpose")
            ? 1
            : 0;
      return { profile, score };
    })
      .sort((a, b) => b.score - a.score)
      .filter(item => item.score > 0);

    const seen = new Set<ModelRecommendation["provider"]>();
    const picks: ModelRecommendation[] = [];

    for (const item of ranked) {
      if (seen.has(item.profile.provider)) continue;
      picks.push({
        provider: item.profile.provider,
        model: item.profile.model,
        fit: item.score >= 3 ? "high" : "medium",
        rationale: `Strong for ${task.replace("-", " ")} workloads; tradeoff: ${item.profile.weakness}.`
      });
      seen.add(item.profile.provider);
      if (picks.length === 3) break;
    }

    if (picks.length < 3) {
      for (const fallback of MODEL_CATALOG) {
        if (seen.has(fallback.provider)) continue;
        picks.push({ provider: fallback.provider, model: fallback.model, fit: "medium", rationale: `General fallback for ${task} tasks.` });
        seen.add(fallback.provider);
        if (picks.length === 3) break;
      }
    }

    return picks;
  }
}
