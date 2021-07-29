import { Client } from "pg";
import { PostgresConnectionParams } from "../../types/integrations/postgres";

export function runPostgresQuery<T>(
  conn: PostgresConnectionParams,
  sql: string,
  values: string[] = []
): Promise<T[]> {
  return new Promise<T[]>((resolve, reject) => {
    const client = new Client(conn);
    client
      .on("error", (err) => {
        reject(err);
      })
      .connect()
      .then(() => client.query(sql, values))
      .then(async (res) => {
        try {
          await client.end();
        } catch (e) {
          console.error(e);
        }
        resolve(res.rows);
      })
      .catch((e) => {
        reject(e);
      });
  });
}
