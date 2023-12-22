export interface WebhookInterface {
  id: string;
  organization: string;
  name: string;
  endpoint: string;
  project?: string;
  environment?: string;
  featuresOnly?: boolean;
  signingKey: string;
  lastSuccess: Date | null;
  error: string;
  created: Date;
  useSDKMode: boolean;
  sendPayload: boolean;
  sdks: string[];
  headers?: string;
  method?: WebhookMethod;
}

export type WebhookMethod = "GET" | "PUT" | "POST" | "DELETE" | "PURGE";
