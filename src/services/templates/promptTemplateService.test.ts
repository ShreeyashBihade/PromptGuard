import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { describe, expect, it } from "vitest";
import { PromptTemplateService } from "./promptTemplateService";

describe("PromptTemplateService", () => {
  it("loads workspace, team, and global templates and expands variables", () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "promptguard-templates-"));
    const globalRoot = fs.mkdtempSync(path.join(os.tmpdir(), "promptguard-global-"));
    fs.mkdirSync(path.join(workspaceRoot, ".promptguard"), { recursive: true });
    fs.mkdirSync(path.join(globalRoot, ""), { recursive: true });

    fs.writeFileSync(path.join(workspaceRoot, "promptguard.templates.json"), JSON.stringify({
      version: 1,
      name: "Starter templates",
      templates: [
        {
          id: "summary",
          name: "Executive summary",
          description: "Create a concise summary prompt",
          content: "You are a senior analyst.\n\nTask: write an executive summary about {{topic}}."
        }
      ]
    }, undefined, 2), "utf8");
    fs.writeFileSync(path.join(workspaceRoot, ".promptguard", "templates.team.json"), JSON.stringify({
      version: 1,
      name: "Team templates",
      templates: [
        {
          id: "team-brief",
          name: "Team brief",
          description: "Align with team briefing style",
          content: "Team: {{team}}\n\nTask: summarize the latest update."
        }
      ]
    }, undefined, 2), "utf8");
    fs.writeFileSync(path.join(globalRoot, "promptguard.templates.json"), JSON.stringify({
      version: 1,
      name: "Global templates",
      templates: [
        {
          id: "global-checklist",
          name: "Global checklist",
          description: "Reusable cross-workspace checklist",
          content: "Task: produce a checklist for {{topic}}."
        }
      ]
    }, undefined, 2), "utf8");

    const service = new PromptTemplateService(workspaceRoot, globalRoot);
    const templates = service.listTemplates();

    expect(templates).toHaveLength(3);
    expect(templates[0]?.name).toBe("Executive summary");
    expect(templates[0]?.scope).toBe("workspace");
    expect(templates[0]?.variables.map(variable => variable.name)).toContain("topic");
    expect(service.getTemplateContent(templates[0]!, { topic: "release notes" })).toContain("release notes");
    expect(service.buildSnippetBody(templates[0]!) ).toContain("${1:topic}");
    expect(service.listTemplates("team")).toHaveLength(1);
    expect(service.listTemplates("global")).toHaveLength(1);
  });
});
