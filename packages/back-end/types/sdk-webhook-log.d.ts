export interface EventWebHookLogInterface {
  id: string;
  webhookId: string;
  webhookReduestId: string;
  organizationId: string;
  dateCreated: Date;
  responseCode: number | null;
  responseBody: string | null;
  result: "error" | "success";
  payload: Record<string, unknown>;
}
