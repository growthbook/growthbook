import { createPrivateKey } from "crypto";
import { createConnection } from "snowflake-sdk";
import { ExternalIdCallback, QueryResponse } from "shared/types/integrations";
import { SnowflakeConnectionParams } from "shared/types/integrations/snowflake";
import { QueryMetadata } from "shared/types/query";
import { TEST_QUERY_SQL } from "back-end/src/integrations/SqlIntegration";
import { getQueryTagString } from "back-end/src/util/integration";

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
// eslint-disable-next-line
export async function runSnowflakeQuery<T extends Record<string, any>>(
  conn: SnowflakeConnectionParams,
  sql: string,
  setExternalId?: ExternalIdCallback,
  queryMetadata?: QueryMetadata,
): Promise<QueryResponse<T[]>> {
  //remove out the .us-west-2 from the account name
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

  const connection = createConnection({
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

  // promise with timeout to prevent hanging, esp. for test query
  const connectionTimeout = sql === TEST_QUERY_SQL ? 30000 : 600000;
  await new Promise((resolve, reject) => {
    const promiseTimeout = setTimeout(() => {
      reject(new Error("Snowflake connection timeout"));
    }, connectionTimeout);
    connection.connect((err, conn) => {
      clearTimeout(promiseTimeout);
      if (err) {
        reject(err);
      } else {
        resolve(conn);
      }
    });
  });

  const res = await new Promise<{
    rows: T[];
    columns: { name: string }[];
  }>((resolve, reject) => {
    connection.execute({
      sqlText: sql,
      complete: async (err, stmt, rows) => {
        if (setExternalId) {
          const queryId = await stmt.getQueryId();
          if (queryId) {
            setExternalId(queryId);
          }
        }
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
          resolve({ rows: rows || [], columns });
        }
      },
    });
  });

  // Annoyingly, Snowflake turns all column names into all caps
  // Need to lowercase them here so they match other data sources
  const lowercase = res.rows.map((row) => {
    return Object.fromEntries(
      Object.entries(row).map(([k, v]) => [k.toLowerCase(), v]),
    ) as T;
  });

  return { rows: lowercase, columns: res.columns };
}
