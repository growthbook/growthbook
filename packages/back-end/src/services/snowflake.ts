import { createPrivateKey } from "crypto";
import { Connection, createConnection } from "snowflake-sdk";
import { version as SNOWFLAKE_SDK_VERSION } from "snowflake-sdk/package.json";
import { ExternalIdCallback, QueryResponse } from "shared/types/integrations";
import { SnowflakeConnectionParams } from "shared/types/integrations/snowflake";
import { QueryMetadata } from "shared/types/query";
import { TEST_QUERY_SQL } from "back-end/src/integrations/SqlIntegration";
import { getQueryTagString } from "back-end/src/util/integration";
import { logger } from "back-end/src/util/logger";

type ProxyOptions = {
  proxyHost?: string;
  proxyPassword?: string;
  proxyUser?: string;
  proxyPort?: number;
  proxyProtocol?: string;
};
function getProxySettings(): ProxyOptions {
  const uri = process.env.SNOWFLAKE_PROXY;
  if (!uri) return {};

  const parsed = new URL(uri);
  return {
    proxyProtocol: parsed.protocol.replace(":", ""),
    proxyHost: parsed.hostname,
    proxyPort: (parsed.port ? parseInt(parsed.port) : 0) || undefined,
    proxyUser: parsed.username || undefined,
    proxyPassword: parsed.password || undefined,
  };
}

const SNOWFLAKE_QUERY_TAG_MAX_LENGTH = 2000;

function buildSnowflakeConnection(
  conn: SnowflakeConnectionParams,
  queryMetadata?: QueryMetadata,
): Connection {
  // remove the .us-west-2 from the account name
  const account = conn.account.replace(/\.us-west-2$/, "");

  let authenticationDetails;
  if (conn.authMethod === "key-pair") {
    try {
      const privateKeyObject = createPrivateKey({
        key: conn.privateKey!,
        format: "pem",
        passphrase: conn.privateKeyPassword,
      });

      authenticationDetails = {
        authenticator: "SNOWFLAKE_JWT",
        privateKey: privateKeyObject
          .export({
            format: "pem",
            type: "pkcs8",
          })
          .toString(),
      };
    } catch (e) {
      throw new Error("Invalid private key or private key password");
    }
  } else {
    authenticationDetails = {
      password: conn.password,
    };
  }

  return createConnection({
    account,
    username: conn.username,
    ...authenticationDetails,

    database: conn.database,
    schema: conn.schema,
    warehouse: conn.warehouse,
    role: conn.role,
    ...getProxySettings(),
    application: "GrowthBook_GrowthBook",
    accessUrl: conn.accessUrl ? conn.accessUrl : undefined,
    queryTag: getQueryTagString(
      queryMetadata ?? {},
      SNOWFLAKE_QUERY_TAG_MAX_LENGTH,
    ),
  });
}

function connectSnowflake(
  connection: Connection,
  timeoutMs: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const promiseTimeout = setTimeout(() => {
      reject(new Error("Snowflake connection timeout"));
    }, timeoutMs);
    connection.connect((err) => {
      clearTimeout(promiseTimeout);
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });
}

function destroySnowflakeConnection(connection: Connection): Promise<void> {
  return new Promise((resolve) => {
    if (!connection.isUp()) {
      resolve();
      return;
    }
    connection.destroy((err) => {
      if (err) {
        logger.debug(`Failed to destroy Snowflake connection: ${err.message}`);
      }
      resolve();
    });
  });
}

// eslint-disable-next-line
export async function runSnowflakeQuery<T extends Record<string, any>>(
  conn: SnowflakeConnectionParams,
  sql: string,
  setExternalId?: ExternalIdCallback,
  queryMetadata?: QueryMetadata,
): Promise<QueryResponse<T[]>> {
  const connection = buildSnowflakeConnection(conn, queryMetadata);

  // The connection holds an HTTP keep-alive session and an SDK heartbeat
  // timer; both leak if we don't explicitly destroy the connection on every
  // exit path. Wrap everything from here on (including connect, so any OS
  // resources allocated mid-handshake are released) in try/finally.
  try {
    // promise with timeout to prevent hanging, esp. for test query
    const connectionTimeout = sql === TEST_QUERY_SQL ? 30000 : 600000;
    await connectSnowflake(connection, connectionTimeout);

    // Submit with asyncExec: true so Snowflake responds immediately with the
    // queryId before the query finishes executing to manage this query (e.g.
    // cancel it in flight)
    const queryId = await new Promise<string>((resolve, reject) => {
      connection.execute({
        sqlText: sql,
        asyncExec: true,
        complete: (err, stmt) => {
          if (err) {
            reject(err);
          } else {
            const id = stmt.getQueryId();
            if (!id) {
              // We submitted with `asyncExec: true`, in which case the SDK is
              // contractually required to populate a queryId on the statement
              // before invoking `complete`. Hitting this branch points at an
              // SDK regression or a Snowflake control-plane response shape
              // change — not anything the user did to their SQL.
              reject(
                new Error(
                  `Snowflake did not return a query ID for an asynchronous ` +
                    `execution. This is almost certainly a bug in ` +
                    `snowflake-sdk@${SNOWFLAKE_SDK_VERSION} or a Snowflake ` +
                    `REST API change rather than a problem with your query; ` +
                    `please report it with the SDK version and any driver ` +
                    `logs.`,
                ),
              );
            } else {
              resolve(id);
            }
          }
        },
      });
    });

    // Persist the query ID immediately — this is what lets cancelQuery work
    // while the query is still running.
    if (setExternalId) {
      try {
        await setExternalId(queryId);
      } catch (e) {
        logger.debug(
          `Snowflake: failed to persist external id ${queryId}: ${
            e instanceof Error ? e.message : String(e)
          }`,
        );
      }
    }

    // Wait for the query to finish and fetch the results.
    const res = await new Promise<{
      rows: T[];
      columns: { name: string }[];
    }>((resolve, reject) => {
      connection
        .getResultsFromQueryId({
          queryId,
          complete: (err, stmt, rows) => {
            if (err) {
              reject(err);
            } else {
              // Extract column metadata from the statement
              const stmtColumns = stmt.getColumns();
              const columns = stmtColumns
                ? stmtColumns.map((col) => ({
                    name: col.getName().toLowerCase(),
                  }))
                : [];
              resolve({ rows: (rows as T[]) || [], columns });
            }
          },
        })
        .catch(reject);
    });

    // Annoyingly, Snowflake turns all column names into all caps
    // Need to lowercase them here so they match other data sources
    const lowercase = res.rows.map((row) => {
      return Object.fromEntries(
        Object.entries(row).map(([k, v]) => [k.toLowerCase(), v]),
      ) as T;
    });

    return { rows: lowercase, columns: res.columns };
  } finally {
    await destroySnowflakeConnection(connection);
  }
}

// Cancels a running Snowflake query by issuing a direct abort against the
// REST API. We construct a Statement bound to the existing query id via
// `connection.fetchResult` and call `.cancel()` on it — that posts to
// `/queries/<queryId>/abort-request`, which is the same control-plane
// endpoint Snowflake's Web UI uses for "Cancel Query".
export async function cancelSnowflakeQuery(
  conn: SnowflakeConnectionParams,
  queryId: string,
): Promise<void> {
  if (!queryId) {
    logger.debug(
      `Failed to cancel Snowflake query ${queryId}: No query ID provided`,
    );
    return;
  }

  const connection = buildSnowflakeConnection(conn);
  try {
    await connectSnowflake(connection, 30000);

    await new Promise<void>((resolve, reject) => {
      // `fetchResult` requires `sqlText` per the TS types but doesn't use
      // it on the cancel path today — only the queryId on the statement
      // context matters for the abort URL. Pass a non-empty sentinel so we
      // don't silently break if a future SDK version starts validating
      // sqlText (e.g. rejecting empty strings).
      const statement = connection.fetchResult({
        queryId,
        sqlText: "-- growthbook cancel",
        // Side effect of fetchResult is a result-fetch request, which we
        // don't care about. Swallow whatever it returns.
        complete: () => {},
      });

      statement.cancel((err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });

    logger.debug(`Cancelled Snowflake query ${queryId}`);
  } catch (e) {
    logger.debug(
      `Failed to cancel Snowflake query ${queryId}: ${
        e instanceof Error ? e.message : String(e)
      }`,
    );
  } finally {
    await destroySnowflakeConnection(connection);
  }
}
