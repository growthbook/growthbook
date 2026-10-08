import { describe, it, expect } from "vitest";
import { SDKConnectionInterface } from "shared/types/sdk-connection";
import {
  linkedChangePremiumCopy,
  linkedChangeSdkSupported,
  linkedChangeSdkUnsupportedCopy,
  type LinkedChangeTarget,
} from "@/components/Experiment/LinkedChanges/AddLinkedChanges";

const connection = (
  sdkVersion: string,
  projects: string[] = [],
): Partial<SDKConnectionInterface> => ({
  languages: ["javascript"],
  sdkVersion,
  projects,
});

const experimentTarget: LinkedChangeTarget = {
  project: "prj_a",
  noun: "experiment",
  types: ["feature-flag", "visual-editor", "redirects"],
};

const cbTarget: LinkedChangeTarget = {
  project: "prj_a",
  noun: "contextual bandit",
  types: ["feature-flag", "visual-editor"],
  extraSdkCapabilities: { "visual-editor": ["contextualBanditsAuto"] },
  sdkUnsupportedCopy: { "visual-editor": "Bandit copy" },
};

describe("linkedChangeSdkSupported", () => {
  it("always supports feature flags", () => {
    expect(linkedChangeSdkSupported("feature-flag", cbTarget, [])).toBe(true);
  });

  it("requires the base capability for the change type", () => {
    expect(
      linkedChangeSdkSupported("visual-editor", experimentTarget, [
        connection("0.20.0"),
      ]),
    ).toBe(false);
    expect(
      linkedChangeSdkSupported("visual-editor", experimentTarget, [
        connection("1.0.0"),
      ]),
    ).toBe(true);
  });

  it("also requires the target's extra capabilities", () => {
    expect(
      linkedChangeSdkSupported("visual-editor", cbTarget, [
        connection("1.8.0"),
      ]),
    ).toBe(false);
    expect(
      linkedChangeSdkSupported("visual-editor", cbTarget, [
        connection("1.8.1"),
      ]),
    ).toBe(true);
  });

  it("ignores connections scoped to other projects", () => {
    expect(
      linkedChangeSdkSupported("visual-editor", cbTarget, [
        connection("1.8.1", ["prj_other"]),
      ]),
    ).toBe(false);
    expect(
      linkedChangeSdkSupported("visual-editor", cbTarget, [
        connection("1.8.1", ["prj_a"]),
      ]),
    ).toBe(true);
  });
});

describe("linked change copy", () => {
  it("prefers the target's unsupported copy and falls back to the generic one", () => {
    expect(linkedChangeSdkUnsupportedCopy("visual-editor", cbTarget)).toBe(
      "Bandit copy",
    );
    expect(
      linkedChangeSdkUnsupportedCopy("visual-editor", experimentTarget),
    ).toContain("AI Visual Editor");
  });

  it("names the target in the premium copy", () => {
    expect(linkedChangePremiumCopy(cbTarget)).toContain("contextual bandit");
  });
});
