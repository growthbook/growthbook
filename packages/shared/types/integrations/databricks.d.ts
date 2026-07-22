export interface DatabricksConnectionParams {
  authType: "pat" | "oauth-m2m";
  token?: string; // Legacy PAT auth
  oauthClientId?: string; // OAuth auth
  oauthClientSecret?: string; // OAuth auth
  host: string;
  port: number;
  path: string;
  catalog: string;
  clientId?: string; // SDK telemetry, not auth
}
