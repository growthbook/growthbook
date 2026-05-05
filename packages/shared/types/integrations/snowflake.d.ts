export interface SnowflakeConnectionParams {
  account: string;
  accessUrl?: string;
  username: string;
  password: string;
  database: string;
  schema: string;
  role?: string;
  warehouse?: string;
  authMethod?: "password" | "key-pair";
  privateKey?: string;
  privateKeyPassword?: string;
}
