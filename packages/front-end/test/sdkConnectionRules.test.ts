import { describe, expect, it } from "vitest";
import { withAbsentSdkSettings } from "shared/enterprise";
import {
  advancedValueFromConnection,
  defaultSavedGroupFormat,
  deliveryModeFromConnection,
  sanitizeAdvancedForSave,
  SDKConnectionAdvancedValue,
  shouldShowPayloadSecurity,
  languagesPatch,
  scriptTagLanguage,
  sdkVersionLabel,
} from "@/components/Features/SDKConnections/sdkConnectionRules";

const allOn: SDKConnectionAdvancedValue = {
  includeVisualExperiments: true,
  includeRedirectExperiments: true,
  allowCustomJs: true,
  allowCrossOriginRedirects: true,
  includeExperimentNames: false,
  savedGroupFormat: "referencesV2",
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
  tracesEnabled: true,
};

const fullyCapable: Parameters<typeof sanitizeAdvancedForSave>[1] = {
  latestCapabilities: ["visualEditor", "redirects", "savedGroupReferences"],
  currentCapabilities: ["savedGroupReferences"],
};

describe("script tag versions", () => {
  it("finds a connection whose one SDK is the script tag", () => {
    expect(scriptTagLanguage(["nocode-shopify"])).toBe("nocode-shopify");
    expect(scriptTagLanguage(["javascript"])).toBe(null);
    expect(scriptTagLanguage(["nocode-other", "javascript"])).toBe(null);
  });

  it("names the script tag a version stands for", () => {
    expect(sdkVersionLabel(["nocode-other"], "0.0.0")).toBe(
      "Legacy (auto.min.js)",
    );
    expect(sdkVersionLabel(["nocode-other"], undefined)).toBe(
      "Legacy (auto.min.js)",
    );
    expect(sdkVersionLabel(["nocode-other"], "3.0.0")).toBe("v3");
  });

  it("leaves other SDK versions as they are", () => {
    expect(sdkVersionLabel(["javascript"], "3.0.0")).toBe("3.0.0");
    expect(sdkVersionLabel(undefined, "1.2.3")).toBe("1.2.3");
    expect(sdkVersionLabel(["javascript"], undefined)).toBe("");
  });

  it("starts a new script tag connection on the newest script tag", () => {
    expect(
      sdkVersionLabel(
        ["nocode-other"],
        languagesPatch(["nocode-other"]).sdkVersion,
      ),
    ).toBe("v3");
  });
});

describe("shouldShowPayloadSecurity", () => {
  it("hides the secured modes for Next.js only", () => {
    expect(shouldShowPayloadSecurity(["nextjs"])).toBe(false);
    expect(shouldShowPayloadSecurity(["javascript", "nextjs"])).toBe(false);
    expect(shouldShowPayloadSecurity(["javascript"])).toBe(true);
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
  it("uses the defaults for a new connection", () => {
    expect(advancedValueFromConnection()).toEqual({
      includeVisualExperiments: false,
      includeRedirectExperiments: false,
      allowCustomJs: false,
      allowCrossOriginRedirects: false,
      includeExperimentNames: true,
      savedGroupFormat: "inline",
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
      tracesEnabled: false,
    });
  });

  it("derives the saved group format from the legacy boolean", () => {
    expect(
      advancedValueFromConnection({ savedGroupReferencesEnabled: true })
        .savedGroupFormat,
    ).toBe("referencesV1");
    expect(
      advancedValueFromConnection({
        savedGroupReferencesEnabled: true,
        savedGroupFormat: "referencesV2",
      }).savedGroupFormat,
    ).toBe("referencesV2");
  });

  it("seeds from a stored connection, including the proxy", () => {
    expect(
      advancedValueFromConnection({
        includeRuleIds: true,
        includeExperimentNames: false,
        allowedCustomFieldsInMetadata: ["cf_a"],
        proxy: {
          enabled: true,
          host: "https://p.example.com",
          signingKey: "",
          connected: false,
          version: "",
          error: "",
          lastError: null,
        },
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

  it("only persists saved group references when the SDK can read them", () => {
    expect(
      sanitizeAdvancedForSave(allOn, {
        ...fullyCapable,
        currentCapabilities: [],
      }).savedGroupFormat,
    ).toBe("inline");
  });

  it("clears custom-field dependants but keeps the typed proxy host", () => {
    const result = sanitizeAdvancedForSave(
      { ...allOn, includeCustomFieldsInMetadata: false, proxyEnabled: false },
      fullyCapable,
    );
    expect(result.allowedCustomFieldsInMetadata).toEqual([]);
    expect(result.proxyHost).toBe(allOn.proxyHost);
  });
});

describe("defaultSavedGroupFormat", () => {
  it("picks the most capable format the SDK can read, only with the plan", () => {
    expect(
      defaultSavedGroupFormat({
        currentCapabilities: ["savedGroupReferences", "savedGroupReferencesV2"],
        hasLargeSavedGroupFeature: true,
      }),
    ).toBe("referencesV2");
    expect(
      defaultSavedGroupFormat({
        currentCapabilities: ["savedGroupReferences"],
        hasLargeSavedGroupFeature: true,
      }),
    ).toBe("referencesV1");
    expect(
      defaultSavedGroupFormat({
        currentCapabilities: [],
        hasLargeSavedGroupFeature: true,
      }),
    ).toBe("inline");
    expect(
      defaultSavedGroupFormat({
        currentCapabilities: ["savedGroupReferences", "savedGroupReferencesV2"],
        hasLargeSavedGroupFeature: false,
      }),
    ).toBe("inline");
  });
});

describe("withAbsentSdkSettings", () => {
  it("fills what a snapshot left out as the payload reads it", () => {
    const filled = withAbsentSdkSettings({ name: "Web", encryptPayload: true });
    expect(filled).toMatchObject({
      name: "Web",
      encryptPayload: true,
      includeDraftExperiments: false,
      includeExperimentNames: false,
      allowedCustomFieldsInMetadata: [],
      proxyEnabled: false,
    });
  });

  it("keeps values the snapshot has", () => {
    expect(
      withAbsentSdkSettings({
        includeExperimentNames: true,
        allowedCustomFieldsInMetadata: ["cf_1"],
      }),
    ).toMatchObject({
      includeExperimentNames: true,
      allowedCustomFieldsInMetadata: ["cf_1"],
    });
  });

  it("leaves the legacy saved-group flag and the format alone", () => {
    const filled = withAbsentSdkSettings({});
    expect(filled).not.toHaveProperty("savedGroupReferencesEnabled");
    expect(filled).not.toHaveProperty("savedGroupFormat");
  });

  it("leaves the auto experiment opt-ins alone, so a revert keeps them", () => {
    const filled = withAbsentSdkSettings({ includeVisualExperiments: true });
    expect(filled).not.toHaveProperty("allowCustomJs");
    expect(filled).not.toHaveProperty("allowCrossOriginRedirects");
  });
});
