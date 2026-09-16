export interface DatabricksConnectionParams {
  authType: "pat" | "oauth-m2m" | "azure-entra";
  token?: string; // Legacy PAT auth
  oauthClientId?: string; // OAuth auth (Databricks-issued or Entra ID service principal)
  oauthClientSecret?: string; // OAuth auth
  azureTenantId?: string; // Entra ID auth only
  host: string;
  port: number;
  path: string;
  catalog: string;
  clientId?: string; // SDK telemetry, not auth
}
