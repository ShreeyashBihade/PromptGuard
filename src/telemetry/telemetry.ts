/** Privacy-first telemetry seam. No events leave the process until a user opts in. */
export interface TelemetryClient { emit(name: string, properties?: Readonly<Record<string, string>>): void; }
export class LocalTelemetryClient implements TelemetryClient { emit(_name: string, _properties?: Readonly<Record<string, string>>): void { /* Deliberately local-only in v1. */ } }
