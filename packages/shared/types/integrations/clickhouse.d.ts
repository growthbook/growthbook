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
  // Self-hosted only: PEM files on the GrowthBook server, used instead of the pasted values
  caCertPath?: string;
  clientCertPath?: string;
  clientKeyPath?: string;
  // Intermediates sent after the client cert
  clientCertChainPath?: string;
}
