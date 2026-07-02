import { ManagedBy } from "shared/validators";

// GrowthBook Proxy
export interface ProxyConnection {
  enabled: boolean;
  host: string;
  hostExternal?: string;
  signingKey: string;
  connected: boolean;
  version: string;
  error: string;
  lastError: Date | null;
  consecutiveFailures?: number;
}

export type EditSDKConnectionParams = {
  name?: string;
  languages?: SDKLanguage[];
  sdkVersion?: string;
  proxyEnabled?: boolean;
  proxyHost?: string;
  environment?: string;
  projects?: string[];
  encryptPayload?: boolean;
  hashSecureAttributes?: boolean;
  includeVisualExperiments?: boolean;
  includeDraftExperiments?: boolean;
  includeDraftExperimentRefs?: boolean;
  includeExperimentNames?: boolean;
  includeRedirectExperiments?: boolean;
  includeRuleIds?: boolean;
  includeProjectIdInMetadata?: boolean;
  includeCustomFieldsInMetadata?: boolean;
  allowedCustomFieldsInMetadata?: string[];
  includeTagsInMetadata?: boolean;
  remoteEvalEnabled?: boolean;
  eventTracker?: string;
  sessionReplayEnabled?: boolean;
};
export type CreateSDKConnectionParams = {
  organization: string;
  name?: string;
  languages?: SDKLanguage[];
  sdkVersion?: string;
  proxyEnabled?: boolean;
  proxyHost?: string;
  environment: string;
  projects: string[];
  encryptPayload: boolean;
  hashSecureAttributes: boolean;
  includeVisualExperiments: boolean;
  includeDraftExperiments: boolean;
  includeDraftExperimentRefs?: boolean;
  includeExperimentNames: boolean;
  includeRedirectExperiments: boolean;
  includeRuleIds: boolean;
  includeProjectIdInMetadata: boolean;
  includeCustomFieldsInMetadata: boolean;
  allowedCustomFieldsInMetadata: string[];
  includeTagsInMetadata: boolean;
  remoteEvalEnabled?: boolean;
  managedBy?: ManagedBy;
  sessionReplayEnabled?: boolean;
};

import { sdkLanguages } from "shared/constants";

export type SDKLanguage = (typeof sdkLanguages)[number];

export interface SDKConnectionInterface {
  id: string;
  organization: string;
  name: string;
  eventTracker?: string;
  dateCreated: Date;
  dateUpdated: Date;

  // The SDK languages being used (e.g. `javascript`). Ideally it should only have 1 language (previously we encouraged multiple)
  languages: SDKLanguage[];
  // The SDK version being used (e.g. `1.0.0`). Assumes a single language, otherwise should default to "0".
  sdkVersion?: string;

  // SDK payload settings
  environment: string;
  projects: string[];
  encryptPayload: boolean;
  encryptionKey: string;
  hashSecureAttributes?: boolean;
  includeVisualExperiments?: boolean;
  includeDraftExperiments?: boolean;
  includeDraftExperimentRefs?: boolean;
  includeExperimentNames?: boolean;
  includeRedirectExperiments?: boolean;
  includeRuleIds?: boolean;
  includeProjectIdInMetadata?: boolean;
  includeCustomFieldsInMetadata?: boolean;
  allowedCustomFieldsInMetadata?: string[];
  includeTagsInMetadata?: boolean;

  // URL slug for fetching features from the API
  key: string;

  // Set to true when it's used for the first time
  connected: boolean;
  proxy: ProxyConnection;

  remoteEvalEnabled?: boolean;
  savedGroupReferencesEnabled?: boolean;
  managedBy?: ManagedBy;

  // Per-connection session-recording on/off, delivered to the SDK in the
  // payload's `sessionReplay.enabled`. Sampling controls (rate, min-duration)
  // are intentionally NOT here — they live in the SDK init config for now to
  // keep the payload small (revisit: fast-follow plan §12.3 Phase 2).
  sessionReplayEnabled?: boolean;
}

export interface ProxyTestResult {
  status: number;
  body: string;
  error: string;
  version: string;
  url: string;
}
