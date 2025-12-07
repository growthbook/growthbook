import { Client, ClientConfig } from "pg";
import { PostgresConnectionParams } from "back-end/types/integrations/postgres";
import { logger } from "back-end/src/util/logger";
import { QueryResponse } from "back-end/src/types/Integration";
import { QUERY_TIMEOUT_MS } from "back-end/src/util/secrets";

export function runPostgresQuery(
  conn: PostgresConnectionParams,
  sql: string,
  values: string[] = [],
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
      connectionTimeoutMillis: 10000,
      query_timeout: QUERY_TIMEOUT_MS,
    };

    const client = new Client(settings);

    // Set a timeout in case the client does not handle the query_timeout correctly
    const timeout = setTimeout(
      () => {
        client.end().catch(() => {});
        reject(
          new Error(`Postgres query exceeded timeout of ${QUERY_TIMEOUT_MS}ms`)
        );
      },
      // Add a buffer to the timeout to ensure client has time to timeout first
      QUERY_TIMEOUT_MS + 1000
    );

    client
      .on("error", (err) => {
        clearTimeout(timeout);
        reject(err);
      })
      .connect()
      .then(() => client.query(sql, values))
      .then(async (res) => {
        clearTimeout(timeout);
        try {
          await client.end();
        } catch (e) {
          logger.warn(e, "Postgres query failed");
        }
        resolve({ rows: res.rows });
      })
      .catch((e) => {
        clearTimeout(timeout);
        reject(e);
      });
  });
}
