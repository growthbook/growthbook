import {
  SavedGroupFormat,
  SDKConnectionInterface,
  SDKLanguage,
} from "shared/types/sdk-connection";
import {
  getConnectionSDKCapabilities,
  getLatestSDKVersion,
  isLegacyScriptTagVersion,
  savedGroupFormatFromConnection,
  SDKCapability,
} from "shared/sdk-versioning";
import { SDKConnectionRevisionSnapshot } from "shared/validators";
import { withAbsentSdkSettings } from "shared/enterprise";

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

// The script tag a connection loads, if that is its one SDK. Its version is
// which script tag URL the site uses, not a version of an installed package.
export function scriptTagLanguage(
  languages: SDKLanguage[],
): SDKLanguage | null {
  const language = languages.length === 1 ? languages[0] : null;
  return language && /^nocode-/.test(language) ? language : null;
}

// How a connection's version reads: the script tag URL for a script tag
// connection, the version number for any other.
export function sdkVersionLabel(
  // A revision snapshot stores languages as plain strings
  languages: string[] | undefined,
  version: string | undefined,
): string {
  const isScriptTag = languages?.length === 1 && /^nocode-/.test(languages[0]);
  if (!isScriptTag) return version ?? "";
  return !version || isLegacyScriptTagVersion(version)
    ? "Legacy (auto.min.js)"
    : `v${version.split(".")[0]}`;
}

// A new single SDK starts on its latest version.
export function languagesPatch(languages: SDKLanguage[]) {
  return languages.length === 1
    ? { languages, sdkVersion: getLatestSDKVersion(languages[0]) }
    : { languages };
}

// Next.js caching can't read a ciphered or remotely-evaluated payload.
export function shouldShowPayloadSecurity(languages: SDKLanguage[]): boolean {
  return !languages.includes("nextjs");
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
  allowCustomJs: boolean;
  allowCrossOriginRedirects: boolean;
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
    // A saved connection without these predates them and still serves both.
    allowCustomJs: c?.id ? (c.allowCustomJs ?? true) : !!c?.allowCustomJs,
    allowCrossOriginRedirects: c?.id
      ? (c.allowCrossOriginRedirects ?? true)
      : !!c?.allowCrossOriginRedirects,
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
function sanitizeSavedGroupFormat(
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
    allowCustomJs: includeVisualExperiments && v.allowCustomJs,
    allowCrossOriginRedirects:
      includeRedirectExperiments && v.allowCrossOriginRedirects,
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

// A snapshot as the payload reads it, so a setting one side left out still
// diffs against the other.
export function snapshotWithAbsentSettings<
  T extends Partial<SDKConnectionRevisionSnapshot>,
>(snapshot: T): T {
  if (!snapshot.sdkConnection) return snapshot;
  return {
    ...snapshot,
    sdkConnection: withAbsentSdkSettings(
      snapshot.sdkConnection,
    ) as T["sdkConnection"],
  };
}
