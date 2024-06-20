export interface DatabricksConnectionParams {
  token: string;
  host: string;
  port: number;
  path: string;
  catalog: string;
  clientId?: string;
}
