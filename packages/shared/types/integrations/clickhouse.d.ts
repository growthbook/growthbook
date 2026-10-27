export interface ClickHouseConnectionParams {
  host?: string;
  url?: string;
  port: number;
  user?: string;
  username?: string;
  password: string;
  database: string;
  maxExecutionTime?: number;
  ssl?: boolean;
  caCert?: string;
  clientCert?: string;
  clientKey?: string;
}
