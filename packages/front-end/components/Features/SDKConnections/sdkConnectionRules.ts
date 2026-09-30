import {
  SavedGroupFormat,
  SDKConnectionInterface,
  SDKLanguage,
} from "shared/types/sdk-connection";
import {
  getConnectionSDKCapabilities,
  savedGroupFormatFromConnection,
} from "shared/sdk-versioning";

type SDKCapability = ReturnType<typeof getConnectionSDKCapabilities>[number];

/**
 * Payload security rules shared by the create and edit surfaces, mirroring
 * the original full form so the split modals stay consistent.
 */

/**
 * Next.js connections must serve plain text — the framework's own caching layer
 * can't read a ciphered or remotely-evaluated payload. Every other language
 * supports encryption and secure attributes.
 */
export function shouldShowPayloadSecurity(
  languages: SDKLanguage[] | undefined,
): boolean {
  return !(languages ?? []).includes("nextjs");
}

export type DeliveryMode = "plain" | "ciphered" | "remote";

/**
 * The Payload Security mode a stored connection is in, as the full form
 * derives it: Remote Eval wins, then either cipher option, else plain text.
 */
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

/** The settings below Payload Security, grouped as the full form groups them. */
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
};

/**
 * Seed the advanced settings from a stored connection, or with the full form's
 * defaults for a new one when nothing is passed.
 */
export function advancedValueFromConnection(
  c?: Partial<SDKConnectionInterface>,
): SDKConnectionAdvancedValue {
  return {
    includeVisualExperiments: !!c?.includeVisualExperiments,
    includeRedirectExperiments: !!c?.includeRedirectExperiments,
    includeExperimentNames: c?.includeExperimentNames ?? true,
    // The model derives `savedGroupFormat` from the old boolean, so a stored
    // connection always resolves; a new one starts inline until the create
    // modal's effect follows the chosen SDK.
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
  };
}

/**
 * The most capable format the chosen SDK can read: the full form's create-time
 * default. Both reference formats need the plan.
 */
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

/**
 * Never persist a reference format the pinned SDK can't read at all, or that
 * the plan doesn't include. `referencesV2` on an SDK that only reads v1 is
 * kept on purpose, as the full form keeps it: the payload steps down to v1 and
 * re-upgrading the SDK resumes v2.
 */
export function sanitizeSavedGroupFormat(
  format: SavedGroupFormat,
  {
    currentCapabilities,
    hasLargeSavedGroupFeature,
  }: {
    currentCapabilities: SDKCapability[];
    hasLargeSavedGroupFeature: boolean;
  },
): SavedGroupFormat {
  return currentCapabilities.includes("savedGroupReferences") &&
    hasLargeSavedGroupFeature
    ? format
    : "inline";
}

/**
 * The persisted shape of the advanced settings, sanitised the way the full
 * form's submit does: never store an option the SDK can't use at its latest
 * version, drop draft experiments when neither parent is on, and clear the
 * dependants of switched-off options.
 */
export function sanitizeAdvancedForSave(
  v: SDKConnectionAdvancedValue,
  {
    latestCapabilities,
    currentCapabilities,
    hasLargeSavedGroupFeature,
  }: {
    latestCapabilities: SDKCapability[];
    currentCapabilities: SDKCapability[];
    hasLargeSavedGroupFeature: boolean;
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
      hasLargeSavedGroupFeature,
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
    // The typed host is kept even while the proxy is off, as the full form
    // did, so re-enabling it doesn't make someone retype it.
    proxyHost: v.proxyHost,
  };
}
