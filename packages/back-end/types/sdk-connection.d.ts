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
  includeExperimentNames?: boolean;
  remoteEvalEnabled?: boolean;
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
  includeExperimentNames: boolean;
  remoteEvalEnabled?: boolean;
};

export type SDKLanguage =
  | "javascript"
  | "nodejs"
  | "react"
  | "php"
  | "ruby"
  | "python"
  | "go"
  | "java"
  | "csharp"
  | "android"
  | "ios"
  | "flutter"
  | "other";

export interface SDKConnectionInterface {
  id: string;
  organization: string;
  name: string;
  dateCreated: Date;
  dateUpdated: Date;

  // The SDK languages being used (e.g. `javascript`). Ideally it should only have 1 language (previously we encouraged multiple)
  languages: SDKLanguage[];
  // The SDK version being used (e.g. `1.0.0`). Assumes a single language, otherwise should default to "0".
  sdkVersion: string; // todo: semver?

  // SDK payload settings
  environment: string;
  projects: string[];
  encryptPayload: boolean;
  encryptionKey: string;
  hashSecureAttributes?: boolean;
  includeVisualExperiments?: boolean;
  includeDraftExperiments?: boolean;
  includeExperimentNames?: boolean;

  // URL slug for fetching features from the API
  key: string;

  // Set to true when it's used for the first time
  connected: boolean;
  proxy: ProxyConnection;

  remoteEvalEnabled?: boolean;
}

export interface ProxyTestResult {
  status: number;
  body: string;
  error: string;
  version: string;
  url: string;
}
