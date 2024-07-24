export interface PrestoConnectionParams {
  authType?: "basicAuth" | "none" | "customAuth";
  engine: "presto" | "trino";
  host: string;
  port: number;
  username?: string;
  password?: string;
  customAuth?: string;
  source?: string;
  catalog: string;
  schema: string;
  ssl?: boolean;
  caCert?: string;
  clientCert?: string;
  clientKey?: string;
  requestTimeout?: number;
}
