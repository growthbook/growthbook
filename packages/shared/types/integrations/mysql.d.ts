export interface MysqlConnectionParams {
  user: string;
  host: string;
  database: string;
  password: string;
  port: number;
  ssl?: boolean;
  caCert?: string;
  clientCert?: string;
  clientKey?: string;
}
