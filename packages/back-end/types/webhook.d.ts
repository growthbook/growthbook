export interface WebhookInterface {
  id: string;
  organization: string;
  name: string;
  endpoint: string;
  signingKey: string;
  lastSuccess: Date;
  error: string;
  created: Date;
}
