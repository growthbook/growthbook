export interface PostgresConnectionParams {
  user: string;
  host: string;
  database: string;
  password: string;
  port: number;
  ssl: string | boolean;
  defaultSchema: string;
  caCert?: string;
  clientCert?: string;
  clientKey?: string;
}
