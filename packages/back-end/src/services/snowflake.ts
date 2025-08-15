import { createPrivateKey } from "crypto";
import { createConnection } from "snowflake-sdk";
import { SnowflakeConnectionParams } from "back-end/types/integrations/snowflake";
import { QueryResponse } from "back-end/src/types/Integration";
import { logger } from "back-end/src/util/logger";
import { TEST_QUERY_SQL } from "back-end/src/integrations/SqlIntegration";

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

// eslint-disable-next-line
export async function runSnowflakeQuery<T extends Record<string, any>>(
  conn: SnowflakeConnectionParams,
  sql: string,
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
        privateKey: privateKeyObject.export({
          format: "pem",
          type: "pkcs8",
        }),
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

  // currently the Node.js driver does not support adding session parameters in the connection string.
  // see https://github.com/snowflakedb/snowflake-connector-nodejs/issues/61 in case they fix it one day.
  // Tagging this session query with the GB tag. This is used to identify queries that are run by GrowthBook
  try {
    await new Promise<void>((resolve, reject) => {
      connection.execute({
        sqlText: "ALTER SESSION SET QUERY_TAG = 'growthbook'",
        complete: (err) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        },
      });
    });
  } catch (e) {
    logger.warn(e, "Snowflake query tag failed");
  }

  const res = await new Promise<T[]>((resolve, reject) => {
    connection.execute({
      sqlText: sql,
      complete: (err, stmt, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows || []);
        }
      },
    });
  });

  // Annoyingly, Snowflake turns all column names into all caps
  // Need to lowercase them here so they match other data sources
  const lowercase = res.map((row) => {
    return Object.fromEntries(
      Object.entries(row).map(([k, v]) => [k.toLowerCase(), v]),
    ) as T;
  });

  return { rows: lowercase };
}
