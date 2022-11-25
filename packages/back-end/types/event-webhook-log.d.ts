export interface EventWebHookLogInterface {
  id: string;
  eventWebHookId: string;
  dateCreated: Date;
  responseCode: string | null;
  error: string | null;
  result: "error" | "success";
  payload: Record<string, unknown>;
}
