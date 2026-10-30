import { describe, it, expect } from "vitest";
import { SDKConnectionInterface } from "shared/types/sdk-connection";
import {
  linkedChangeSdkSupported,
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
  noun: "Contextual Bandit",
  types: ["feature-flag", "visual-editor"],
  extraSdkCapabilities: { "visual-editor": ["contextualBanditsAuto"] },
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
        connection("2.0.0"),
      ]),
    ).toBe(true);
  });

  it("needs one connection that supports every capability itself", () => {
    const serverOnly: Partial<SDKConnectionInterface> = {
      languages: ["nodejs"],
      sdkVersion: "2.0.0",
    };
    expect(
      linkedChangeSdkSupported("visual-editor", cbTarget, [
        connection("1.8.0"),
        serverOnly,
      ]),
    ).toBe(false);
  });

  it("ignores connections scoped to other projects", () => {
    expect(
      linkedChangeSdkSupported("visual-editor", cbTarget, [
        connection("2.0.0", ["prj_other"]),
      ]),
    ).toBe(false);
    expect(
      linkedChangeSdkSupported("visual-editor", cbTarget, [
        connection("2.0.0", ["prj_a"]),
      ]),
    ).toBe(true);
  });
});
