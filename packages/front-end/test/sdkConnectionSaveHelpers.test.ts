import { describe, expect, it, vi } from "vitest";
import { getLatestSDKVersion } from "shared/sdk-versioning";
import {
  sdkConnectionBody,
  SDKConnectionFormValue,
} from "@/components/Features/SDKConnections/SDKConnectionEditModal";
import { proxyHostError } from "@/components/Features/SDKConnections/SDKConnectionAdvancedSettings";
import { checkHeadersOnSubmit } from "@/components/EventWebHooks/WebhookHeadersField";

const form = (
  overrides: Partial<SDKConnectionFormValue> = {},
): SDKConnectionFormValue => ({
  name: "Web",
  languages: ["javascript"],
  sdkVersion: getLatestSDKVersion("javascript"),
  environment: "production",
  projects: ["prj_1"],
  includeReferencedPrerequisites: false,
  delivery: "ciphered",
  encryptPayload: true,
  hashSecureAttributes: true,
  includeVisualExperiments: true,
  includeRedirectExperiments: true,
  includeExperimentNames: true,
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
  ...overrides,
});

describe("sdkConnectionBody", () => {
  it("saves the connection fields and keeps the ciphered settings", () => {
    const body = sdkConnectionBody(form());
    expect(body).toMatchObject({
      name: "Web",
      languages: ["javascript"],
      environment: "production",
      projects: ["prj_1"],
      includeReferencedPrerequisites: false,
      encryptPayload: true,
      hashSecureAttributes: true,
      remoteEvalEnabled: false,
    });
    expect(body).not.toHaveProperty("delivery");
  });

  it("keeps a partial cipher choice as chosen", () => {
    const body = sdkConnectionBody(
      form({ encryptPayload: false, hashSecureAttributes: true }),
    );
    expect(body.encryptPayload).toBe(false);
    expect(body.hashSecureAttributes).toBe(true);
  });

  it("clears the security flags for plain delivery", () => {
    const body = sdkConnectionBody(form({ delivery: "plain" }));
    expect(body.encryptPayload).toBe(false);
    expect(body.hashSecureAttributes).toBe(false);
    expect(body.remoteEvalEnabled).toBe(false);
  });

  it("gives an SDK that can't read a secured payload a plain one", () => {
    for (const delivery of ["ciphered", "remote"] as const) {
      const body = sdkConnectionBody(
        form({
          delivery,
          languages: ["nextjs"],
          sdkVersion: getLatestSDKVersion("nextjs"),
        }),
      );
      expect(body.encryptPayload).toBe(false);
      expect(body.hashSecureAttributes).toBe(false);
      expect(body.remoteEvalEnabled).toBe(false);
    }
  });

  it("turns remote eval on only for remote delivery on an SDK that supports it", () => {
    expect(
      sdkConnectionBody(form({ delivery: "remote" })).remoteEvalEnabled,
    ).toBe(true);
    expect(
      sdkConnectionBody(form({ delivery: "ciphered" })).remoteEvalEnabled,
    ).toBe(false);
    expect(
      sdkConnectionBody(
        form({
          delivery: "remote",
          languages: ["ruby"],
          sdkVersion: getLatestSDKVersion("ruby"),
        }),
      ).remoteEvalEnabled,
    ).toBe(false);
  });

  it("judges remote eval by the SDK's latest version, not the pinned one", () => {
    expect(
      sdkConnectionBody(form({ delivery: "remote", sdkVersion: "0.0.0" }))
        .remoteEvalEnabled,
    ).toBe(true);
  });

  it("passes the advanced settings through when the SDK supports them", () => {
    expect(sdkConnectionBody(form())).toMatchObject({
      includeVisualExperiments: true,
      includeRedirectExperiments: true,
      includeDraftExperiments: true,
      savedGroupFormat: "referencesV2",
      allowedCustomFieldsInMetadata: ["cf_a"],
      proxyEnabled: true,
      proxyHost: "https://proxy.example.com",
      tracesEnabled: true,
    });
  });

  it("clears advanced settings the SDK can't use", () => {
    const body = sdkConnectionBody(
      form({ languages: ["ruby"], sdkVersion: getLatestSDKVersion("ruby") }),
    );
    expect(body.includeVisualExperiments).toBe(false);
    expect(body.includeRedirectExperiments).toBe(false);
    expect(body.includeDraftExperiments).toBe(false);
  });

  it("saves inline saved groups when the pinned version can't read references", () => {
    expect(
      sdkConnectionBody(form({ sdkVersion: "0.0.0" })).savedGroupFormat,
    ).toBe("inline");
  });

  it("drops the allowed custom fields when custom fields are off", () => {
    expect(
      sdkConnectionBody(form({ includeCustomFieldsInMetadata: false }))
        .allowedCustomFieldsInMetadata,
    ).toEqual([]);
  });
});

describe("checkHeadersOnSubmit", () => {
  it("accepts valid JSON without touching the field", () => {
    const setValue = vi.fn();
    expect(() =>
      checkHeadersOnSubmit('{"Authorization": "Bearer x"}', setValue),
    ).not.toThrow();
    expect(setValue).not.toHaveBeenCalled();
  });

  it("repairs broken JSON into the field and asks for another submit", () => {
    const setValue = vi.fn();
    expect(() =>
      checkHeadersOnSubmit("{Authorization: 'x',}", setValue),
    ).toThrow(
      "We fixed some errors in the headers. If they look correct, submit again.",
    );
    expect(setValue).toHaveBeenCalledTimes(1);
    expect(JSON.parse(setValue.mock.calls[0][0])).toEqual({
      Authorization: "x",
    });
  });

  it("refuses headers it can't repair", () => {
    const setValue = vi.fn();
    expect(() => checkHeadersOnSubmit("{{{", setValue)).toThrow(
      "Headers must be valid JSON.",
    );
    expect(setValue).not.toHaveBeenCalled();
  });
});

describe("proxyHostError", () => {
  it("ignores the host while the proxy is off", () => {
    expect(
      proxyHostError({ proxyEnabled: false, proxyHost: "not a url" }),
    ).toBeNull();
  });

  it("allows an empty host", () => {
    expect(proxyHostError({ proxyEnabled: true, proxyHost: "" })).toBeNull();
  });

  it("accepts http and https URLs", () => {
    expect(
      proxyHostError({
        proxyEnabled: true,
        proxyHost: "http://localhost:3300",
      }),
    ).toBeNull();
    expect(
      proxyHostError({
        proxyEnabled: true,
        proxyHost: "https://proxy.example.com",
      }),
    ).toBeNull();
  });

  it("rejects text that isn't a URL and other protocols", () => {
    const message = "Enter a valid http:// or https:// URL";
    expect(
      proxyHostError({ proxyEnabled: true, proxyHost: "proxy.example.com" }),
    ).toBe(message);
    expect(
      proxyHostError({
        proxyEnabled: true,
        proxyHost: "ftp://proxy.example.com",
      }),
    ).toBe(message);
  });
});
