export interface ClickHouseConnectionParams {
  host?: string;
  url?: string;
  port: number;
  user?: string;
  username?: string;
  password: string;
  database: string;
  // ClickHouse cluster name used for cluster-aware statements (e.g. KILL QUERY); empty means run bare statements.
  cluster?: string;
  maxExecutionTime?: number;
}
