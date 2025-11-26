import { ManagedBy } from "back-end/src/validators/managed-by";

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
  managedBy?: ManagedBy;
}

export type WebhookSummary = Pick<
  WebhookInterface,
  "id" | "name" | "endpoint" | "lastSuccess" | "error" | "created"
>;

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
  | "edgeConfigUnescaped"
  | "vercelNativeIntegration"
  | "none";

export type {
  UpdateSdkWebhookProps,
  CreateSdkWebhookProps,
} from "back-end/src/models/WebhookModel";
