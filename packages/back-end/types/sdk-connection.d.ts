// GrowthBook Proxy
export interface ProxyConnection {
  enabled: boolean;
  host: string;
  signingKey: string;
  connected: boolean;
  proxyVersion: string;
  error: string;
  lastError: Date | null;
}

export interface SDKConnectionInterface {
  id: string;
  organization: string;
  description: string;
  dateCreated: Date;
  dateUpdated: Date;

  // The SDK languages being used (e.g. `javascript`)
  languages: string[];

  // SDK payload settings
  environment: string;
  project: string;
  encryptPayload: boolean;
  encryptionKey: string;

  // URL slug for fetching features from the API
  key: string;

  // Set to true when it's used for the first time
  connected: boolean;

  proxy?: ProxyConnection;
}
