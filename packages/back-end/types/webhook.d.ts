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
  payloadKey?: string;
  sdks: string[];
  headers?: string;
  httpMethod?: WebhookMethod;
}

export type WebhookMethod =
  | "GET"
  | "PUT"
  | "POST"
  | "DELETE"
  | "PURGE"
  | "PATCH";

export type WebhookPayloadFormat =
  | "standard"
  | "standard-no-payload"
  | "sdkPayload"
  | "edgeConfig"
  | "none";

export type {
  UpdateSdkWebhookProps,
  CreateSdkWebhookProps,
} from "back-end/src/models/WebhookModel";
