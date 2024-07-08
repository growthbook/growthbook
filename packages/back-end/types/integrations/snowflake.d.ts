export interface SnowflakeConnectionParams {
  account: string;
  username: string;
  password: string;
  database: string;
  schema: string;
  role?: string;
  warehouse?: string;
}
