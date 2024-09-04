import { createConnection } from "snowflake-sdk";
import { SnowflakeConnectionParams } from "../../types/integrations/snowflake";
import { QueryResponse } from "../types/Integration";
import { logger } from "../util/logger";

type ProxyOptions = {
  proxyHost?: string;
  proxyPassword?: string;
  proxyUser?: string;
  proxyPort?: number;
  proxyProtocol?: string;
};

function proxyPort(url: URL): number | undefined {
  if (url.port) {
    return parseInt(url.port);
  }

  if (url.protocol === "http:") {
    return 80;
  }

  if (url.protocol === "https:") {
    return 443;
  }

  return undefined;
}

export function getProxySettings(uri: string | undefined): ProxyOptions {
  if (!uri) return {};

  const parsed = new URL(uri);
  return {
    proxyProtocol: parsed.protocol,
    proxyHost: parsed.hostname,
    proxyPort: proxyPort(parsed),
    proxyUser: parsed.username || undefined,
    proxyPassword: parsed.password || undefined,
  };
}

// eslint-disable-next-line
export async function runSnowflakeQuery<T extends Record<string, any>>(
  conn: SnowflakeConnectionParams,
  sql: string
): Promise<QueryResponse<T[]>> {
  //remove out the .us-west-2 from the account name
  const account = conn.account.replace(/\.us-west-2$/, "");
  const proxy = getProxySettings(process.env.SNOWFLAKE_PROXY);
  const connection = createConnection({
    account,
    username: conn.username,
    password: conn.password,
    database: conn.database,
    schema: conn.schema,
    warehouse: conn.warehouse,
    role: conn.role,
    ...proxy,
    application: "GrowthBook_GrowthBook",
  });
  // promise with timeout to prevent hanging
  await new Promise((resolve, reject) => {
    const promiseTimeout = setTimeout(() => {
      reject(new Error("Snowflake connection timeout"));
    }, 30000);
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
      Object.entries(row).map(([k, v]) => [k.toLowerCase(), v])
    ) as T;
  });

  return { rows: lowercase };
}
