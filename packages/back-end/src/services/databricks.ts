import { DBSQLClient } from "@databricks/sql";
import { DatabricksConnectionParams } from "../../types/integrations/databricks";
import { logger } from "../util/logger";
import { ENVIRONMENT } from "../util/secrets";

export async function runDatabricksQuery<T>(
  conn: DatabricksConnectionParams,
  sql: string
): Promise<T[]> {
  // Because of how Databrick's SDK is written, it may reject or resolve multiple times
  // So we have a quick boolean check to make sure we only do it the first time
  let finished = false;

  // Annoyingly, the `client.connect` method is async, but if there's an error,
  // it just hangs and never rejects. Instead, it emits an "error" event.
  // So we have to wrap everything in a `new Promise()` and handle errors manually
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
      .connect({
        token: conn.token,
        host: conn.host,
        port: conn.port || 443,
        path: conn.path,
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
  return result;
}
