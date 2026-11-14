import { describe, expect, it } from "vitest";
import {
  SDKConnectionRevisionSnapshot,
  SDKConnectionSettingsRevisionSnapshot,
  sdkConnectionUpdatableFieldsSchema,
} from "shared/validators";
import { REVISION_SDK_CONNECTION_DIFF_CONFIG } from "@/components/Features/SDKConnections/SDKConnectionDiffRenders";
import { ABSENT_SETTING_KEYS } from "@/components/Features/SDKConnections/sdkConnectionRules";

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

// As the modals diff them: both sides normalized first.
function rendersChange(pre: Settings, post: Settings): boolean {
  const normalize =
    REVISION_SDK_CONNECTION_DIFF_CONFIG.normalizeSnapshot ??
    ((s: SDKConnectionRevisionSnapshot) => s);
  const before = normalize({ sdkConnection: pre, sdkWebhooks: [] });
  const after = normalize({ sdkConnection: post, sdkWebhooks: [] });
  return REVISION_SDK_CONNECTION_DIFF_CONFIG.sections.some(
    (section) => (section.render(before, after) ?? null) !== null,
  );
}

function without(key: keyof Settings): Settings {
  const settings = { ...base };
  delete settings[key];
  return settings;
}

// Optional settings whose absence isn't read as a value: the format follows the
// legacy boolean, an unset version or host stays unset, and archiving is never
// restored by a revert.
const ABSENT_KEPT_AS_UNSET = new Set<string>([
  "eventTracker",
  "sdkVersion",
  "savedGroupReferencesEnabled",
  "savedGroupFormat",
  "proxyHost",
  "archived",
]);

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

  it("reads every other optional setting's absence as a value", () => {
    const optional = keys.filter((k) =>
      sdkConnectionUpdatableFieldsSchema.shape[k].isOptional(),
    );
    expect(optional.filter((k) => !ABSENT_KEPT_AS_UNSET.has(k)).sort()).toEqual(
      [...ABSENT_SETTING_KEYS].sort(),
    );
  });

  describe.each(ABSENT_SETTING_KEYS as Array<keyof Settings>)(
    "a snapshot without %s",
    (key) => {
      it("differs from one that turned it on", () => {
        const on = { ...base, [key]: changed(key) };
        expect(rendersChange(on, without(key))).toBe(true);
        expect(rendersChange(without(key), on)).toBe(true);
      });

      it("matches one that holds the default", () => {
        expect(rendersChange(base, without(key))).toBe(false);
        expect(rendersChange(without(key), base)).toBe(false);
      });
    },
  );

  it("shows only what a draft behind live would land", () => {
    const live: SDKConnectionRevisionSnapshot = {
      sdkConnection: { ...base, encryptPayload: true },
      sdkWebhooks: [],
    };
    // Cut when encryption was off; renames only.
    const draft = {
      target: {
        snapshot: { sdkConnection: base, sdkWebhooks: [] },
        proposedChanges: [
          {
            op: "replace",
            path: "/sdkConnection",
            value: { ...base, name: "Renamed" },
          },
        ],
      },
    };
    const proposedStateFor =
      REVISION_SDK_CONNECTION_DIFF_CONFIG.proposedStateFor;
    expect(proposedStateFor).toBeDefined();
    const proposed = proposedStateFor ? proposedStateFor(draft, live) : live;
    expect(proposed.sdkConnection).toEqual({
      ...base,
      encryptPayload: true,
      name: "Renamed",
    });
    expect(
      REVISION_SDK_CONNECTION_DIFF_CONFIG.sections
        .filter((section) => (section.render(live, proposed) ?? null) !== null)
        .map((section) => section.label),
    ).toEqual(["Connection"]);
  });
});
