export interface ClickHouseConnectionParams {
  /** @deprecated */
  host?: string;
  url?: string;
  port: number;
  /** @deprecated */
  user?: string;
  username?: string;
  password: string;
  database: string;
  maxExecutionTime?: number;
}
