import { Client, ClientConfig } from "pg";
import { QueryResponse } from "shared/types/integrations";
import { FactTableColumnType } from "shared/types/fact-table";
import { PostgresConnectionParams } from "shared/types/integrations/postgres";
import { logger } from "back-end/src/util/logger";

export async function runPostgresQuery(
  conn: PostgresConnectionParams,
  sql: string,
  values: string[] = [],
  // Maps a column's Postgres type OID onto a Fact Table column type. Passed in
  // rather than assumed, because not every data source on this driver numbers
  // its OIDs the way Postgres does -- see getFactTableTypeFromPostgresOid.
  // Without it, columns are still reported, just with no datatype.
  getDataType?: (oid: number) => FactTableColumnType | undefined,
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
    return {
      rows: res.rows,
      columns: res.fields?.map((field) => {
        const dataType = getDataType?.(field.dataTypeID);
        return { name: field.name, ...(dataType && { dataType }) };
      }),
    };
  } finally {
    try {
      await client.end();
    } catch (e) {
      logger.warn(e, "Failed to close Postgres connection");
    }
  }
}
