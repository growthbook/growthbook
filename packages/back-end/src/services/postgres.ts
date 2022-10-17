import { Client, ClientConfig } from "pg";
import { PostgresConnectionParams } from "../../types/integrations/postgres";
import { logger } from "../util/logger";

export function runPostgresQuery<T>(
  conn: PostgresConnectionParams,
  sql: string,
  values: string[] = []
): Promise<T[]> {
  return new Promise<T[]>((resolve, reject) => {
    let ssl: false | ClientConfig["ssl"] = false;
    if (conn.ssl === true || conn.ssl === "true") {
      ssl = {
        rejectUnauthorized: false,
      };

      if (conn.caCert) {
        ssl.ca = conn.caCert;
      }
      if (conn.clientCert) {
        ssl.cert = conn.clientCert;
      }
      if (conn.clientKey) {
        ssl.key = conn.clientKey;
      }
    }

    const settings: ClientConfig = {
      ...conn,
      ssl,
      // Give it 10 seconds to connect
      connectionTimeoutMillis: 10000,
    };

    const client = new Client(settings);
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
          logger.warn(e, "Postgres query failed");
        }
        resolve(res.rows);
      })
      .catch((e) => {
        reject(e);
      });
  });
}
