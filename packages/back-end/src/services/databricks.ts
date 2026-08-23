import { DBSQLClient } from "@databricks/sql";
import {
  TColumnDesc,
  TTableSchema,
  TTypeId,
} from "@databricks/sql/thrift/TCLIService_types";
import {
  QueryResponse,
  QueryResponseColumnData,
} from "shared/types/integrations";
import { FactTableColumnType } from "shared/types/fact-table";
import { DatabricksConnectionParams } from "shared/types/integrations/databricks";
import { logger } from "back-end/src/util/logger";
import { ENVIRONMENT } from "back-end/src/util/secrets";

type ConnectionOptions = Parameters<DBSQLClient["connect"]>[0];

export function buildDatabricksConnectionOptions(
  conn: DatabricksConnectionParams,
): ConnectionOptions {
  const shared = {
    host: conn.host,
    port: conn.port || 443,
    path: conn.path,
    userAgentEntry: conn.clientId || "GrowthBook",
  };

  if (conn.authType === "oauth-m2m") {
    if (!conn.oauthClientId || !conn.oauthClientSecret) {
      throw new Error("Databricks OAuth requires both a client ID and secret.");
    }

    return {
      ...shared,
      authType: "databricks-oauth",
      oauthClientId: conn.oauthClientId,
      oauthClientSecret: conn.oauthClientSecret,
    };
  }

  if (!conn.token) {
    throw new Error(
      "Databricks personal access token authentication requires a token.",
    );
  }

  return {
    ...shared,
    token: conn.token,
  };
}

function getColumnDataType(
  column: TColumnDesc,
): FactTableColumnType | undefined {
  // HiveServer2 reports the complex types through `primitiveEntry` too, with
  // the details in type qualifiers we don't need
  const typeId = column.typeDesc?.types?.[0]?.primitiveEntry?.type;
  if (typeId === undefined) return undefined;

  switch (typeId) {
    case TTypeId.BOOLEAN_TYPE:
      return "boolean";

    case TTypeId.TINYINT_TYPE:
    case TTypeId.SMALLINT_TYPE:
    case TTypeId.INT_TYPE:
    case TTypeId.BIGINT_TYPE:
    case TTypeId.FLOAT_TYPE:
    case TTypeId.DOUBLE_TYPE:
    case TTypeId.DECIMAL_TYPE:
      return "number";

    case TTypeId.STRING_TYPE:
    case TTypeId.VARCHAR_TYPE:
    case TTypeId.CHAR_TYPE:
      return "string";

    case TTypeId.TIMESTAMP_TYPE:
    case TTypeId.DATE_TYPE:
      return "date";

    case TTypeId.BINARY_TYPE:
      return "binary";

    // Spark SQL has no JSON type; these are its structured equivalents
    case TTypeId.MAP_TYPE:
    case TTypeId.STRUCT_TYPE:
      return "json";

    case TTypeId.ARRAY_TYPE:
    case TTypeId.UNION_TYPE:
    case TTypeId.USER_DEFINED_TYPE:
    case TTypeId.INTERVAL_YEAR_MONTH_TYPE:
    case TTypeId.INTERVAL_DAY_TIME_TYPE:
      return "other";

    // An all-null expression, so the type is unknowable
    case TTypeId.NULL_TYPE:
      return undefined;
  }

  return undefined;
}

/**
 * The query's output schema, which the driver reports whether or not the query
 * matched any rows -- so a LIMIT 0 query is enough to read it. Row keys come
 * from these same `columnName`s, so the two always agree.
 */
export function getDatabricksResultColumns(
  schema: TTableSchema | null,
): QueryResponseColumnData[] | undefined {
  if (!schema?.columns) return undefined;

  return [...schema.columns]
    .sort((a, b) => a.position - b.position)
    .map((column) => {
      const dataType = getColumnDataType(column);
      return { name: column.columnName, ...(dataType && { dataType }) };
    });
}

export async function runDatabricksQuery<T>(
  conn: DatabricksConnectionParams,
  sql: string,
): Promise<QueryResponse<T[]>> {
  // Because of how Databrick's SDK is written, it may reject or resolve multiple times
  // So we have a quick boolean check to make sure we only do it the first time
  let finished = false;

  // Annoyingly, the `client.connect` method is async, but if there's an error,
  // it just hangs and never rejects. Instead, it emits an "error" event.
  // So we have to wrap everything in a `new Promise()` and handle errors manually

  try {
    const result = await new Promise<QueryResponse<T[]>>((resolve, reject) => {
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
        .connect(buildDatabricksConnectionOptions(conn))
        .then(async () => {
          const session = await client.openSession();
          const queryOperation = await session.executeStatement(sql, {
            runAsync: true,
            // This is required to have the results returned immediately
            maxRows: 1000,
          });
          const rows = (await queryOperation.fetchAll({
            progress: false,
          })) as unknown as T[];

          // fetchAll already fetched the result metadata to pick its result
          // handler, and the operation memoizes it -- so this is a cache hit
          // rather than another round trip. Never fail a query that returned
          // rows just because the schema couldn't be read.
          let columns: QueryResponseColumnData[] | undefined;
          try {
            columns = getDatabricksResultColumns(
              await queryOperation.getSchema(),
            );
          } catch (e) {
            logger.warn(e, "Databricks: failed to read the result schema");
          }

          // As soon as we have the reuslt, return it
          if (!finished) {
            finished = true;
            resolve({ rows, columns });
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
    return result;
  } catch (e) {
    if (e.response?.displayMessage) {
      throw new Error(e.response.displayMessage);
    }
    throw new Error(e.message);
  }
}
