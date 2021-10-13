export interface WebhookInterface {
  id: string;
  organization: string;
  name: string;
  endpoint: string;
  signingKey: string;
  lastSuccess: Date | null;
  error: string;
  created: Date;
}
