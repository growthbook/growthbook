import { describe, expect, it } from "vitest";
import {
  SDKConnectionRevisionSnapshot,
  SDKConnectionSettingsRevisionSnapshot,
  sdkConnectionUpdatableFieldsSchema,
} from "shared/validators";
import { REVISION_SDK_CONNECTION_DIFF_CONFIG } from "@/components/Features/SDKConnections/SDKConnectionDiffRenders";

// Every setting a revision tracks has to show up in the review diff. One that
// doesn't makes a draft changing only it read as empty (so it can't publish),
// and a live change to it never shows a draft as behind.
type Settings = SDKConnectionSettingsRevisionSnapshot;

const base: Settings = {
  id: "sdk_1",
  organization: "org_1",
  name: "Web",
  eventTracker: "",
  languages: ["javascript"],
  sdkVersion: "1.0.0",
  environment: "production",
  projects: ["prj_1"],
  encryptPayload: false,
  hashSecureAttributes: false,
  includeVisualExperiments: false,
  includeDraftExperiments: false,
  includeDraftExperimentRefs: false,
  includeExperimentNames: false,
  includeRedirectExperiments: false,
  includeRuleIds: false,
  includeProjectIdInMetadata: false,
  includeCustomFieldsInMetadata: false,
  allowedCustomFieldsInMetadata: [],
  includeTagsInMetadata: false,
  includeExperimentScheduleInMetadata: false,
  remoteEvalEnabled: false,
  tracesEnabled: false,
  savedGroupReferencesEnabled: false,
  savedGroupFormat: "inline",
  includeReferencedPrerequisites: false,
  proxyEnabled: false,
  proxyHost: "",
  archived: false,
};

// A different value of the same type, so the test needs no per-key table.
function changed(key: keyof Settings): unknown {
  const value = base[key];
  if (typeof value === "boolean") return !value;
  if (Array.isArray(value)) return [...value, "other"];
  if (key === "savedGroupFormat") return "referencesV2";
  return `${String(value)}-changed`;
}

// Kept in step with its twin by the model, and shown as the format.
const SHOWN_AS_ANOTHER_FIELD = new Set<string>(["savedGroupReferencesEnabled"]);

function rendersChange(pre: Settings, post: Settings): boolean {
  const before: Partial<SDKConnectionRevisionSnapshot> = {
    sdkConnection: pre,
    sdkWebhooks: [],
  };
  const after: Partial<SDKConnectionRevisionSnapshot> = {
    sdkConnection: post,
    sdkWebhooks: [],
  };
  return REVISION_SDK_CONNECTION_DIFF_CONFIG.sections.some(
    (section) => (section.render(before, after) ?? null) !== null,
  );
}

describe("SDK connection review diff", () => {
  const keys = Object.keys(sdkConnectionUpdatableFieldsSchema.shape) as Array<
    keyof Settings
  >;

  it("has a fixture value for every tracked setting", () => {
    expect(Object.keys(base).sort()).toEqual(
      [...keys, "id", "organization"].sort(),
    );
  });

  it("renders nothing when nothing changed", () => {
    expect(rendersChange(base, base)).toBe(false);
  });

  it.each(keys.filter((k) => !SHOWN_AS_ANOTHER_FIELD.has(k)))(
    "shows a change to %s",
    (key) => {
      expect(rendersChange(base, { ...base, [key]: changed(key) })).toBe(true);
    },
  );
});
