import { describe, expect, it } from "vitest";
import {
  advancedValueFromConnection,
  deliveryModeFromConnection,
  sanitizeAdvancedForSave,
  SDKConnectionAdvancedValue,
  shouldShowPayloadSecurity,
} from "@/components/Features/SDKConnections/sdkConnectionRules";

const allOn: SDKConnectionAdvancedValue = {
  includeVisualExperiments: true,
  includeRedirectExperiments: true,
  includeExperimentNames: false,
  savedGroupReferencesEnabled: true,
  includeProjectIdInMetadata: true,
  includeCustomFieldsInMetadata: true,
  allowedCustomFieldsInMetadata: ["cf_a"],
  includeTagsInMetadata: true,
  includeExperimentScheduleInMetadata: true,
  includeRuleIds: true,
  includeDraftExperimentRefs: true,
  includeDraftExperiments: true,
  proxyEnabled: true,
  proxyHost: "https://proxy.example.com",
};

const fullyCapable = {
  latestCapabilities: ["visualEditor", "redirects", "savedGroupReferences"],
  currentCapabilities: ["savedGroupReferences"],
  hasLargeSavedGroupFeature: true,
} as Parameters<typeof sanitizeAdvancedForSave>[1];

describe("shouldShowPayloadSecurity", () => {
  it("hides the secured modes for Next.js only", () => {
    expect(shouldShowPayloadSecurity(["nextjs"])).toBe(false);
    expect(shouldShowPayloadSecurity(["javascript", "nextjs"])).toBe(false);
    expect(shouldShowPayloadSecurity(["javascript"])).toBe(true);
    expect(shouldShowPayloadSecurity(undefined)).toBe(true);
  });
});

describe("deliveryModeFromConnection", () => {
  it("prefers remote eval, then either cipher option, else plain", () => {
    expect(
      deliveryModeFromConnection({
        remoteEvalEnabled: true,
        encryptPayload: true,
      }),
    ).toBe("remote");
    expect(deliveryModeFromConnection({ encryptPayload: true })).toBe(
      "ciphered",
    );
    expect(deliveryModeFromConnection({ hashSecureAttributes: true })).toBe(
      "ciphered",
    );
    expect(deliveryModeFromConnection({})).toBe("plain");
  });
});

describe("advancedValueFromConnection", () => {
  it("uses the full form's defaults for a new connection", () => {
    expect(advancedValueFromConnection()).toEqual({
      includeVisualExperiments: false,
      includeRedirectExperiments: false,
      includeExperimentNames: true,
      savedGroupReferencesEnabled: false,
      includeProjectIdInMetadata: false,
      includeCustomFieldsInMetadata: false,
      allowedCustomFieldsInMetadata: [],
      includeTagsInMetadata: false,
      includeExperimentScheduleInMetadata: false,
      includeRuleIds: false,
      includeDraftExperimentRefs: false,
      includeDraftExperiments: false,
      proxyEnabled: false,
      proxyHost: "",
    });
  });

  it("seeds from a stored connection, including the proxy", () => {
    expect(
      advancedValueFromConnection({
        includeRuleIds: true,
        includeExperimentNames: false,
        allowedCustomFieldsInMetadata: ["cf_a"],
        proxy: { enabled: true, host: "https://p.example.com" } as never,
      }),
    ).toMatchObject({
      includeRuleIds: true,
      includeExperimentNames: false,
      allowedCustomFieldsInMetadata: ["cf_a"],
      proxyEnabled: true,
      proxyHost: "https://p.example.com",
    });
  });
});

describe("sanitizeAdvancedForSave", () => {
  it("passes everything through when the SDK supports it all", () => {
    expect(sanitizeAdvancedForSave(allOn, fullyCapable)).toEqual(allOn);
  });

  it("clears experiment options the SDK can't run at its latest version", () => {
    const result = sanitizeAdvancedForSave(allOn, {
      ...fullyCapable,
      latestCapabilities: [],
    });
    expect(result.includeVisualExperiments).toBe(false);
    expect(result.includeRedirectExperiments).toBe(false);
    // Draft auto-experiments need at least one parent option.
    expect(result.includeDraftExperiments).toBe(false);
    // Draft rules are independent of the visual/redirect capabilities.
    expect(result.includeDraftExperimentRefs).toBe(true);
  });

  it("keeps draft experiments when only one parent option survives", () => {
    const result = sanitizeAdvancedForSave(allOn, {
      ...fullyCapable,
      latestCapabilities: ["redirects"],
    });
    expect(result.includeVisualExperiments).toBe(false);
    expect(result.includeRedirectExperiments).toBe(true);
    expect(result.includeDraftExperiments).toBe(true);
  });

  it("only persists saved group references with capability and entitlement", () => {
    expect(
      sanitizeAdvancedForSave(allOn, {
        ...fullyCapable,
        currentCapabilities: [],
      }).savedGroupReferencesEnabled,
    ).toBe(false);
    expect(
      sanitizeAdvancedForSave(allOn, {
        ...fullyCapable,
        hasLargeSavedGroupFeature: false,
      }).savedGroupReferencesEnabled,
    ).toBe(false);
  });

  it("clears the dependants of switched-off options", () => {
    const result = sanitizeAdvancedForSave(
      { ...allOn, includeCustomFieldsInMetadata: false, proxyEnabled: false },
      fullyCapable,
    );
    expect(result.allowedCustomFieldsInMetadata).toEqual([]);
    expect(result.proxyHost).toBe("");
  });
});
