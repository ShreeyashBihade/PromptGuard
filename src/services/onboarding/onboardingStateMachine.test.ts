import { describe, expect, it } from "vitest";
import { OnboardingStateMachine } from "./onboardingStateMachine";

describe("OnboardingStateMachine", () => {
  it("maps non-allowed stages to deterministic states", () => {
    const machine = new OnboardingStateMachine();

    expect(machine.current()).toBe("idle");
    expect(machine.transition({ allowed: false, stage: "api-unconfigured", message: "x" })).toBe("api-unconfigured");
    expect(machine.transition({ allowed: false, stage: "consent-denied", message: "x" })).toBe("policy-pending");
    expect(machine.transition({ allowed: false, stage: "session-cancelled", message: "x" })).toBe("verification-pending");
    expect(machine.transition({ allowed: false, stage: "session-ready", message: "x" })).toBe("project-pending");
    expect(machine.transition({ allowed: false, stage: "policy-recorded", message: "x" })).toBe("project-pending");
    expect(machine.transition({ allowed: false, stage: "api-error", message: "x" })).toBe("api-error");
  });

  it("forces activated when result is allowed", () => {
    const machine = new OnboardingStateMachine();

    expect(machine.transition({ allowed: true, stage: "project-ready", message: "ok" })).toBe("activated");
    expect(machine.current()).toBe("activated");
  });
});
