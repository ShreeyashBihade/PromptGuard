import * as vscode from "vscode";

export interface PromptTraceSnapshot {
  traceId: string;
  source: string;
  startedAt: string;
}

export interface PromptTraceStep {
  phase: string;
  details: Readonly<Record<string, string | number | boolean | undefined>>;
}

export class PromptTraceLogger implements vscode.Disposable {
  private readonly channel = vscode.window.createOutputChannel("PromptGuard Trace");

  start(source: string): PromptTraceSnapshot {
    const traceId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const startedAt = new Date().toISOString();
    this.channel.appendLine(`[${startedAt}] trace=${traceId} source=${source} phase=start`);
    return { traceId, source, startedAt };
  }

  step(snapshot: PromptTraceSnapshot, step: PromptTraceStep): void {
    this.channel.appendLine(`[${new Date().toISOString()}] trace=${snapshot.traceId} source=${snapshot.source} phase=${step.phase} ${this.serialize(step.details)}`);
  }

  end(snapshot: PromptTraceSnapshot, details: Readonly<Record<string, string | number | boolean | undefined>> = {}): void {
    this.channel.appendLine(`[${new Date().toISOString()}] trace=${snapshot.traceId} source=${snapshot.source} phase=end ${this.serialize(details)}`);
  }

  dispose(): void {
    this.channel.dispose();
  }

  private serialize(details: Readonly<Record<string, string | number | boolean | undefined>>): string {
    return Object.entries(details)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => `${key}=${String(value).replace(/\s+/g, " ")}`)
      .join(" ");
  }
}
