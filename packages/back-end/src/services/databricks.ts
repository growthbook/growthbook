import { DBSQLClient } from "@databricks/sql";
import { DatabricksConnectionParams } from "back-end/types/integrations/databricks";
import { logger } from "back-end/src/util/logger";
import { ENVIRONMENT } from "back-end/src/util/secrets";
import { QueryResponse } from "back-end/src/types/Integration";
import { TTypeId } from "@databricks/sql/thrift/TCLIService_types";

export async function runDatabricksQuery<T>(
  conn: DatabricksConnectionParams,
  sql: string
): Promise<QueryResponse<T[]>> {
  // Because of how Databrick's SDK is written, it may reject or resolve multiple times
  // So we have a quick boolean check to make sure we only do it the first time
  let finished = false;

  // Annoyingly, the `client.connect` method is async, but if there's an error,
  // it just hangs and never rejects. Instead, it emits an "error" event.
  // So we have to wrap everything in a `new Promise()` and handle errors manually

  try {
    const result = await new Promise<{columns: QueryResponse["columns"], rows: T[]}>((resolve, reject) => {
      const client = new DBSQLClient({
        logger: {
          log(level, message) {
            if (ENVIRONMENT !== "production") {
              logger.info({ db: "Databricks", level }, message);
            }
          },
        },
      });
      client
        .on("error", (error) => {
          if (!finished) {
            finished = true;
            reject(error);
          }
        })
        .connect({
          token: conn.token,
          host: conn.host,
          port: conn.port || 443,
          path: conn.path,
          clientId: conn.clientId || "GrowthBook",
        })
        .then(async () => {
          const session = await client.openSession();
          const queryOperation = await session.executeStatement(sql, {
            runAsync: true,
            // This is required to have the results returned immediately
            maxRows: 1000,
          });
          const result = ((await queryOperation.fetchAll({
            progress: false,
          })) as unknown) as Promise<T[]>;

          // As soon as we have the result, return it
          if (!finished) {
            const rows = await result;
            const schema = await queryOperation.getSchema();
            const columns = schema?.columns?.map((c) => ({name: c.columnName, type: getDatabricksType(c.typeDesc.types[0].primitiveEntry?.type)}));
            console.log(columns);
            finished = true;
            resolve({rows, columns: columns});
          }

          // Do cleanup in the background and ignore errors
          await queryOperation.close();
          await session.close();
          await client.close();
        })
        .catch((e) => {
          if (!finished) {
            finished = true;
            reject(e);
          }
        });
    });
    return { rows: result.rows, columns: result.columns };
  } catch (e) {
    if (e.response?.displayMessage) {
      throw new Error(e.response.displayMessage);
    }
    throw new Error(e.message);
  }
}

const getDatabricksType = (type: TTypeId | undefined) => {
  if (type === undefined) {
    return "unknown";
  }
  if (type === TTypeId.BOOLEAN_TYPE) {
    return "boolean";
  }
  if (type === TTypeId.INT_TYPE || type === TTypeId.BIGINT_TYPE || type === TTypeId.SMALLINT_TYPE || type === TTypeId.TINYINT_TYPE) {
    return "number";
  }
  if (type === TTypeId.STRING_TYPE) {
    return "string";
  }
  if (type === TTypeId.FLOAT_TYPE || type === TTypeId.DOUBLE_TYPE) {
    return "number";
  }
  if (type === TTypeId.TIMESTAMP_TYPE || type === TTypeId.DATE_TYPE) {
    return "datetime";
  }
  if (type === TTypeId.BINARY_TYPE) {
    return "binary";
  }
  if (type === TTypeId.DECIMAL_TYPE) {
    return "number";
  }
  if (type === TTypeId.NULL_TYPE) {
    return "null";
  }
  return "unknown";
}