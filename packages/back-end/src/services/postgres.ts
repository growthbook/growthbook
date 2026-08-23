import { Client, ClientConfig } from "pg";
import { QueryResponse } from "shared/types/integrations";
import { FactTableColumnType } from "shared/types/fact-table";
import { PostgresConnectionParams } from "shared/types/integrations/postgres";
import { logger } from "back-end/src/util/logger";

export function runPostgresQuery(
  conn: PostgresConnectionParams,
  sql: string,
  values: string[] = [],
  // Maps a column's Postgres type OID onto a Fact Table column type. Passed in
  // rather than assumed, because not every data source on this driver numbers
  // its OIDs the way Postgres does -- see getFactTableTypeFromPostgresOid.
  // Without it, columns are still reported, just with no datatype.
  getDataType?: (oid: number) => FactTableColumnType | undefined,
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
        // `fields` describes the query's output schema and comes back even
        // when no rows matched, so a LIMIT 0 query is enough to read it
        resolve({
          rows: res.rows,
          columns: res.fields?.map((field) => {
            const dataType = getDataType?.(field.dataTypeID);
            return { name: field.name, ...(dataType && { dataType }) };
          }),
        });
      })
      .catch((e) => {
        reject(e);
      });
  });
}
