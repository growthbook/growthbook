export interface WebhookInterface {
  id: string;
  organization: string;
  name: string;
  endpoint: string;
  project?: string;
  environment?: string;
  featuresOnly?: boolean;
  signingKey: string;
  apiKey?: string;
  lastSuccess: Date | null;
  error: string;
  created: Date;
}
