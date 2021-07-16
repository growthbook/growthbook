export interface PrestoConnectionParams {
  engine: "presto" | "trino";
  host: string;
  port: number;
  username: string;
  password: string;
  catalog: string;
  schema: string;
}
