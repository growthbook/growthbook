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
};

export function advancedValueFromConnection(
  c?: Partial<SDKConnectionInterface>,
): SDKConnectionAdvancedValue {
  return {
    includeVisualExperiments: !!c?.includeVisualExperiments,
    includeRedirectExperiments: !!c?.includeRedirectExperiments,
    includeExperimentNames: c?.includeExperimentNames ?? true,
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
  };
}
