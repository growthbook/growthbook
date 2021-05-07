import { Client } from "pg";
import { PostgresConnectionParams } from "../../types/integrations/postgres";

export async function runPostgresQuery<T>(
  conn: PostgresConnectionParams,
  sql: string,
  values: string[] = []
): Promise<T[]> {
  const client = new Client(conn);
  await client.connect();
  const res = await client.query(sql, values);
  await client.end();
  return res.rows;
}
