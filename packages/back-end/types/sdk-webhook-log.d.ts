export interface SdkWebHookLogInterface {
  id: string;
  webhookId: string;
  /** @deprecated */
  webhookReduestId?: string;
  webhookRequestId?: string;
  organizationId: string;
  dateCreated: Date;
  responseCode: number | null;
  responseBody: string | null;
  result: "error" | "success";
  payload: Record<string, unknown>;
}
