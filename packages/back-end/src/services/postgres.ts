import { Client, ClientConfig } from "pg";
import { QueryResponse } from "shared/types/integrations";
import { PostgresConnectionParams } from "shared/types/integrations/postgres";
import { logger } from "back-end/src/util/logger";

export async function runPostgresQuery(
  conn: PostgresConnectionParams,
  sql: string,
  values: string[] = [],
): Promise<QueryResponse> {
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

  // Unhandled pg "error" events crash the process; race them into a rejection
  const socketError = new Promise<never>((_, reject) => {
    client.on("error", reject);
  });

  try {
    const res = await Promise.race([
      client.connect().then(() => client.query(sql, values)),
      socketError,
    ]);
    return { rows: res.rows };
  } finally {
    try {
      await client.end();
    } catch (e) {
      logger.warn(e, "Failed to close Postgres connection");
    }
  }
}
