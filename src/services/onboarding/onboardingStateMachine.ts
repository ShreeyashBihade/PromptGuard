import { OnboardingResult, OnboardingStage } from "../../api/promptGuardApi";

export type OnboardingState =
  | "idle"
  | "api-unconfigured"
  | "policy-pending"
  | "verification-pending"
  | "project-pending"
  | "activated"
  | "blocked"
  | "api-error";

export class OnboardingStateMachine {
  private state: OnboardingState = "idle";

  current(): OnboardingState {
    return this.state;
  }

  reset(): void {
    this.state = "idle";
  }

  transition(result: OnboardingResult): OnboardingState {
    const next = this.mapStage(result.stage);
    this.state = result.allowed ? "activated" : next;
    return this.state;
  }

  private mapStage(stage: OnboardingStage): OnboardingState {
    switch (stage) {
      case "api-unconfigured":
        return "api-unconfigured";
      case "consent-denied":
        return "policy-pending";
      case "session-cancelled":
        return "verification-pending";
      case "session-ready":
      case "policy-recorded":
        return "project-pending";
      case "project-ready":
        return "activated";
      case "api-error":
      default:
        return "api-error";
    }
  }
}
