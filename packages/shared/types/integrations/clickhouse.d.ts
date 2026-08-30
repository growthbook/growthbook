export interface ClickHouseConnectionParams {
  host?: string;
  url?: string;
  port: number;
  user?: string;
  username?: string;
  password: string;
  database: string;
  maxExecutionTime?: number;
}
