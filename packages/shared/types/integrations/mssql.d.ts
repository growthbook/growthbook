export interface MssqlConnectionParams {
  user: string;
  server: string;
  database: string;
  password: string;
  port: number;
  defaultSchema?: string;
  requestTimeout?: number;
  options?: {
    encrypt?: boolean; // for azure
    trustServerCertificate?: boolean; // change to true for local dev / self-signed certs
  };
}
