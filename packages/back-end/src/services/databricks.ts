import { DBSQLClient } from "@databricks/sql";
import { QueryResponse } from "shared/types/integrations";
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
    clientId: conn.clientId || "GrowthBook",
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
    const result = await new Promise<T[]>((resolve, reject) => {
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
          const result = (await queryOperation.fetchAll({
            progress: false,
          })) as unknown as Promise<T[]>;

          // As soon as we have the reuslt, return it
          if (!finished) {
            finished = true;
            resolve(result);
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
    return { rows: result };
  } catch (e) {
    if (e.response?.displayMessage) {
      throw new Error(e.response.displayMessage);
    }
    throw new Error(e.message);
  }
}
