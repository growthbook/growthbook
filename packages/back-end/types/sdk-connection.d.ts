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
  proxyEnabled?: boolean;
  proxyHost?: string;
  environment?: string;
  project?: string;
  encryptPayload?: boolean;
};
export type CreateSDKConnectionParams = {
  organization: string;
  name?: string;
  languages?: SDKLanguage[];
  proxyEnabled?: boolean;
  proxyHost?: string;
  environment: string;
  project: string;
  encryptPayload: boolean;
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

  // The SDK languages being used (e.g. `javascript`)
  languages: SDKLanguage[];

  // SDK payload settings
  environment: string;
  project: string;
  encryptPayload: boolean;
  encryptionKey: string;

  // URL slug for fetching features from the API
  key: string;

  // Set to true when it's used for the first time
  connected: boolean;

  proxy: ProxyConnection;
}

export interface ProxyTestResult {
  status: number;
  body: string;
  error: string;
  version: string;
  url: string;
}
