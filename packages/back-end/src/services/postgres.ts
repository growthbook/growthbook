import { Client, ClientConfig } from "pg";
import { PostgresConnectionParams } from "../../types/integrations/postgres";

export async function getPostgresClient(conn: PostgresConnectionParams) {
  const settings: ClientConfig = {
    ...conn,
    ssl:
      conn.ssl === true || conn.ssl === "true"
        ? {
            rejectUnauthorized: false,
          }
        : false,
  };

  const client = new Client(settings);
  await client.connect();

  return {
    client,
    destroy: () => client.end(),
  };
}

export function runPostgresQuery<T>(
  client: Client,
  sql: string,
  values: string[] = []
): Promise<T[]> {
  return new Promise<T[]>((resolve, reject) => {
    const onError = (err: Error) => {
      client.off("error", onError);
      reject(err);
    };
    client.on("error", onError);
    client
      .query(sql, values)
      .then(async (res) => {
        client.off("error", onError);
        resolve(res.rows);
      })
      .catch(onError);
  });
}
