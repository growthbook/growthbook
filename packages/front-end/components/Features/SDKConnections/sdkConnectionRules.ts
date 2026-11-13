import {
  SavedGroupFormat,
  SDKConnectionInterface,
  SDKLanguage,
} from "shared/types/sdk-connection";
import {
  getConnectionSDKCapabilities,
  getLatestSDKVersion,
  savedGroupFormatFromConnection,
} from "shared/sdk-versioning";
import { SDKConnectionRevisionSnapshot } from "shared/validators";
import { applyTopLevelPatchOps, landedOps } from "shared/enterprise";

export type SDKCapability = ReturnType<
  typeof getConnectionSDKCapabilities
>[number];

// What the oldest SDK version supports now, and what upgrading could unlock.
export function connectionCapabilities(c: {
  languages: SDKLanguage[];
  sdkVersion?: string;
}) {
  return {
    currentCaps: getConnectionSDKCapabilities(c, "min-ver-intersection"),
    latestCaps: getConnectionSDKCapabilities(c, "max-ver-intersection"),
  };
}

// The one SDK a connection pins a version of, if it has one.
export function versionedLanguage(
  languages: SDKLanguage[],
): SDKLanguage | null {
  const language = languages.length === 1 ? languages[0] : null;
  return language && !/^(other|nocode-.*)$/.test(language) ? language : null;
}

// A new single SDK starts on its latest version.
export function languagesPatch(languages: SDKLanguage[]) {
  return languages.length === 1
    ? { languages, sdkVersion: getLatestSDKVersion(languages[0]) }
    : { languages };
}

// Next.js caching can't read a ciphered or remotely-evaluated payload.
export function shouldShowPayloadSecurity(
  languages: SDKLanguage[] | undefined,
): boolean {
  return !(languages ?? []).includes("nextjs");
}

export type DeliveryMode = "plain" | "ciphered" | "remote";

export function deliveryModeFromConnection(
  c: Partial<
    Pick<
      SDKConnectionInterface,
      "remoteEvalEnabled" | "encryptPayload" | "hashSecureAttributes"
    >
  >,
): DeliveryMode {
  if (c.remoteEvalEnabled) return "remote";
  if (c.encryptPayload || c.hashSecureAttributes) return "ciphered";
  return "plain";
}

export type SDKConnectionAdvancedValue = {
  // Experiments
  includeVisualExperiments: boolean;
  includeRedirectExperiments: boolean;
  includeExperimentNames: boolean;
  // Saved Groups
  savedGroupFormat: SavedGroupFormat;
  // Payload Metadata
  includeProjectIdInMetadata: boolean;
  includeCustomFieldsInMetadata: boolean;
  allowedCustomFieldsInMetadata: string[];
  includeTagsInMetadata: boolean;
  includeExperimentScheduleInMetadata: boolean;
  // Observability and QA
  includeRuleIds: boolean;
  includeDraftExperimentRefs: boolean;
  includeDraftExperiments: boolean;
  // GrowthBook Proxy
  proxyEnabled: boolean;
  proxyHost: string;
  // Traces
  tracesEnabled: boolean;
};

export function advancedValueFromConnection(
  c?: Partial<SDKConnectionInterface>,
): SDKConnectionAdvancedValue {
  return {
    includeVisualExperiments: !!c?.includeVisualExperiments,
    includeRedirectExperiments: !!c?.includeRedirectExperiments,
    // A saved connection without it serves no names; a new one defaults on.
    includeExperimentNames: c?.id
      ? !!c.includeExperimentNames
      : (c?.includeExperimentNames ?? true),
    savedGroupFormat: c ? savedGroupFormatFromConnection(c) : "inline",
    includeProjectIdInMetadata: !!c?.includeProjectIdInMetadata,
    includeCustomFieldsInMetadata: !!c?.includeCustomFieldsInMetadata,
    allowedCustomFieldsInMetadata: c?.allowedCustomFieldsInMetadata ?? [],
    includeTagsInMetadata: !!c?.includeTagsInMetadata,
    includeExperimentScheduleInMetadata:
      !!c?.includeExperimentScheduleInMetadata,
    includeRuleIds: !!c?.includeRuleIds,
    includeDraftExperimentRefs: !!c?.includeDraftExperimentRefs,
    includeDraftExperiments: !!c?.includeDraftExperiments,
    proxyEnabled: !!c?.proxy?.enabled,
    proxyHost: c?.proxy?.host ?? "",
    tracesEnabled: !!c?.tracesEnabled,
  };
}

export function defaultSavedGroupFormat({
  currentCapabilities,
  hasLargeSavedGroupFeature,
}: {
  currentCapabilities: SDKCapability[];
  hasLargeSavedGroupFeature: boolean;
}): SavedGroupFormat {
  if (!hasLargeSavedGroupFeature) return "inline";
  if (currentCapabilities.includes("savedGroupReferencesV2"))
    return "referencesV2";
  if (currentCapabilities.includes("savedGroupReferences"))
    return "referencesV1";
  return "inline";
}

// referencesV2 on an SDK that only reads v1 is kept on purpose: the payload
// steps down to v1 and re-upgrading the SDK resumes v2.
export function sanitizeSavedGroupFormat(
  format: SavedGroupFormat,
  { currentCapabilities }: { currentCapabilities: SDKCapability[] },
): SavedGroupFormat {
  return currentCapabilities.includes("savedGroupReferences")
    ? format
    : "inline";
}

export function sanitizeAdvancedForSave(
  v: SDKConnectionAdvancedValue,
  {
    latestCapabilities,
    currentCapabilities,
  }: {
    latestCapabilities: SDKCapability[];
    currentCapabilities: SDKCapability[];
  },
): SDKConnectionAdvancedValue {
  const includeVisualExperiments =
    latestCapabilities.includes("visualEditor") && v.includeVisualExperiments;
  const includeRedirectExperiments =
    latestCapabilities.includes("redirects") && v.includeRedirectExperiments;
  return {
    includeVisualExperiments,
    includeRedirectExperiments,
    includeExperimentNames: v.includeExperimentNames,
    savedGroupFormat: sanitizeSavedGroupFormat(v.savedGroupFormat, {
      currentCapabilities,
    }),
    includeProjectIdInMetadata: v.includeProjectIdInMetadata,
    includeCustomFieldsInMetadata: v.includeCustomFieldsInMetadata,
    allowedCustomFieldsInMetadata: v.includeCustomFieldsInMetadata
      ? v.allowedCustomFieldsInMetadata
      : [],
    includeTagsInMetadata: v.includeTagsInMetadata,
    includeExperimentScheduleInMetadata: v.includeExperimentScheduleInMetadata,
    includeRuleIds: v.includeRuleIds,
    includeDraftExperimentRefs: v.includeDraftExperimentRefs,
    includeDraftExperiments:
      (includeVisualExperiments || includeRedirectExperiments) &&
      v.includeDraftExperiments,
    proxyEnabled: v.proxyEnabled,
    // Kept while the proxy is off so re-enabling it doesn't mean retyping it.
    proxyHost: v.proxyHost,
    tracesEnabled: v.tracesEnabled,
  };
}

// How the payload reads a setting a snapshot leaves out. A revert sends these
// for what the older snapshot lacked, so options added since are turned back
// off rather than kept. The legacy saved-group boolean is left out: sent on its
// own it would switch the format to inline.
const ABSENT_SETTING_VALUES: Record<string, unknown> = {
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
  includeReferencedPrerequisites: false,
  proxyEnabled: false,
};

export function withAbsentSettings(
  settings: Record<string, unknown>,
): Record<string, unknown> {
  const filled = { ...settings };
  for (const [key, value] of Object.entries(ABSENT_SETTING_VALUES)) {
    if (filled[key] === undefined) filled[key] = value;
  }
  return filled;
}

export const ABSENT_SETTING_KEYS = Object.keys(ABSENT_SETTING_VALUES);

// A snapshot as the payload reads it, so a setting one side left out still
// diffs against the other.
export function snapshotWithAbsentSettings<
  T extends Partial<SDKConnectionRevisionSnapshot>,
>(snapshot: T): T {
  if (!snapshot.sdkConnection) return snapshot;
  return {
    ...snapshot,
    sdkConnection: withAbsentSettings(
      snapshot.sdkConnection,
    ) as T["sdkConnection"],
  };
}

// What publishing a draft lands: its settings op replaces the whole object, but
// the server merges it per setting, so live's later changes it never touched
// are kept.
export function draftLandedState<T extends Record<string, unknown>>(
  revision: { target: { snapshot: unknown; proposedChanges: unknown } },
  live: T,
): T {
  return applyTopLevelPatchOps(
    live,
    landedOps(
      live,
      revision.target.snapshot as Record<string, unknown>,
      revision.target.proposedChanges,
    ),
  );
}
