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
  useSdkMode: boolean;
  /** @deprecated */
  sendPayload?: boolean;
  payloadFormat?: WebhookPayloadFormat;
  sdks: string[];
  headers?: string;
  httpMethod?: WebhookMethod;
}

export type WebhookMethod = "GET" | "PUT" | "POST" | "DELETE" | "PURGE";

export type WebhookPayloadFormat =
  | "standard"
  | "standard-no-payload"
  | "sdkPayload"
  | "none";

export type {
  UpdateSdkWebhookProps,
  CreateSdkWebhookProps,
} from "../src/models/WebhookModel";
