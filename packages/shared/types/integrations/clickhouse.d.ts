export interface ClickHouseConnectionParams {
  host?: string;
  url?: string;
  port: number;
  user?: string;
  username?: string;
  // Not sent when a client certificate is configured
  password?: string;
  database: string;
  maxExecutionTime?: number;
  // Self-hosted only. Paths to PEM files on the GrowthBook server.
  caCertPath?: string;
  clientCertPath?: string;
  clientKeyPath?: string;
  // Intermediates sent after the client certificate
  clientCertChainPath?: string;
}
