export interface TelemetryClient {
  emit(event: string, data?: Record<string, string>): void;
}

export class LocalTelemetryClient implements TelemetryClient {
  emit(): void {}
}
