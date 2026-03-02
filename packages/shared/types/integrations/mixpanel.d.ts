export interface MixpanelConnectionParams {
  username: string;
  secret: string;
  projectId: string;
  server?: "standard" | "eu";
}
