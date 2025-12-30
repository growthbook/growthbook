import { ManagedBy, WebhookPayloadFormat } from "shared/validators";

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

export type {
  UpdateSdkWebhookProps,
  CreateSdkWebhookProps,
  WebhookPayloadFormat,
} from "shared/validators";
