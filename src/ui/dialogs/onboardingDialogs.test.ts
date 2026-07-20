import { describe, expect, it } from "vitest";
import { OnboardingDialogs } from "./onboardingDialogs";

describe("OnboardingDialogs", () => {
  it("renders onboarding step content and loading text", () => {
    const dialogs = new OnboardingDialogs();

    const emailHtml = dialogs.emailHtml();
    const otpHtml = dialogs.otpHtml("user@example.com");
    const projectHtml = dialogs.projectHtml("user@example.com", "PromptGuard");
    const loadingHtml = dialogs.loadingHtml("Loading your projects...");

    expect(emailHtml).toContain("Set up PromptGuard");
    expect(otpHtml).toContain("Verify your email");
    expect(projectHtml).toContain("Name your project");
    expect(loadingHtml).toContain("Loading your projects...");
  });
});