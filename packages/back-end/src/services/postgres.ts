import { Client, ClientConfig } from "pg";
import { PostgresConnectionParams } from "../../types/integrations/postgres";
import { logger } from "../util/logger";
import { QueryResponse } from "../types/Integration";

export function runPostgresQuery(
  conn: PostgresConnectionParams,
  sql: string,
  values: string[] = []
): Promise<QueryResponse> {
  return new Promise<QueryResponse>((resolve, reject) => {
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
        resolve({ rows: res.rows });
      })
      .catch((e) => {
        reject(e);
      });
  });
}
