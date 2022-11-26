export interface EventWebHookLogInterface {
  id: string;
  eventWebHookId: string;
  organizationId: string;
  dateCreated: Date;
  responseCode: string | null;
  error: string | null;
  result: "error" | "success";
  payload: Record<string, unknown>;
}
