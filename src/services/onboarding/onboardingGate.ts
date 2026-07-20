import { OnboardingResult, PromptGuardApi } from "../../api/promptGuardApi";
import { OnboardingState, OnboardingStateMachine } from "./onboardingStateMachine";

export interface OnboardingAuthorization {
  allowed: boolean;
  state: OnboardingState;
  stage: OnboardingResult["stage"];
  reason?: string;
  httpStatus?: number;
}

export class OnboardingGate {
  private readonly state = new OnboardingStateMachine();

  constructor(private readonly api: PromptGuardApi) {}

  async authorizeForGroq(): Promise<OnboardingAuthorization> {
    const result = await this.api.authorizeGroqForwardingDetailed();
    const nextState = this.state.transition(result);
    return { allowed: result.allowed, state: nextState, stage: result.stage, reason: result.allowed ? undefined : result.message, httpStatus: result.httpStatus };
  }

  async startOnboarding(): Promise<OnboardingAuthorization> {
    const result = await this.api.startOnboardingDetailed();
    const nextState = this.state.transition(result);
    return { allowed: result.allowed, state: nextState, stage: result.stage, reason: result.allowed ? undefined : result.message, httpStatus: result.httpStatus };
  }

  async resetOnboarding(): Promise<void> {
    await this.api.resetOnboardingState();
    this.state.reset();
  }

  async logout(): Promise<void> {
    await this.api.logout();
    this.state.reset();
  }

  async deleteAccount(): Promise<void> {
    await this.api.deleteAccount();
    this.state.reset();
  }

  async recordOriginalPrompt(prompt: string): Promise<string | undefined> {
    return this.api.recordOriginalPrompt(prompt);
  }

  async recordModifiedPrompt(promptId: string | undefined, modifiedPrompt: string): Promise<void> {
    await this.api.recordModifiedPrompt(promptId, modifiedPrompt);
  }

  async chooseProject(forceCreate = false): Promise<void> {
    await this.api.chooseProject(forceCreate);
  }

  currentState(): OnboardingState {
    return this.state.current();
  }
}
