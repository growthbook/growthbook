import { Athena } from "aws-sdk";
import { ResultSet } from "aws-sdk/clients/athena";
import { logger } from "@back-end/src/util/logger";
import { IS_CLOUD } from "@back-end/src/util/secrets";
import { AthenaConnectionParams } from "@back-end/types/integrations/athena";
import {
  ExternalIdCallback,
  QueryResponse,
} from "@back-end/src/types/Integration";

function getAthenaInstance(params: AthenaConnectionParams) {
  if (!IS_CLOUD && params.authType === "auto") {
    return new Athena({
      region: params.region,
    });
  }

  return new Athena({
    accessKeyId: params.accessKeyId,
    secretAccessKey: params.secretAccessKey,
    region: params.region,
  });
}

export async function cancelAthenaQuery(
  conn: AthenaConnectionParams,
  id: string
) {
  const athena = getAthenaInstance(conn);
  await athena
    .stopQueryExecution({
      QueryExecutionId: id,
    })
    .promise();
}

export async function runAthenaQuery(
  conn: AthenaConnectionParams,
  sql: string,
  setExternalId: ExternalIdCallback
): Promise<QueryResponse> {
  const athena = getAthenaInstance(conn);

  const { database, bucketUri, workGroup, catalog } = conn;

  const retryWaitTime =
    (parseInt(process.env.ATHENA_RETRY_WAIT_TIME || "60") || 60) * 1000;

  const { QueryExecutionId } = await athena
    .startQueryExecution({
      QueryString: sql,
      QueryExecutionContext: {
        Database: database || undefined,
        Catalog: catalog || undefined,
      },
      ResultConfiguration: {
        EncryptionConfiguration: {
          EncryptionOption: "SSE_S3",
        },
        OutputLocation: bucketUri,
      },
      WorkGroup: workGroup || "primary",
    })
    .promise();

  if (!QueryExecutionId) {
    throw new Error("Failed to start query");
  }

  if (setExternalId) {
    await setExternalId(QueryExecutionId);
  }

  let timeWaitingForFailure = 0;
  const waitAndCheck = (delay: number) => {
    return new Promise<false | ResultSet>((resolve, reject) => {
      setTimeout(() => {
        athena
          .getQueryExecution({ QueryExecutionId })
          .promise()
          .then((resp) => {
            const State = resp.QueryExecution?.Status?.State;
            const StateChangeReason =
              resp.QueryExecution?.Status?.StateChangeReason;

            if (State === "RUNNING" || State === "QUEUED") {
              if (timeWaitingForFailure > 0) {
                logger.debug(
                  `Athena query (${QueryExecutionId}) recovered from SlowDown error in ${
                    timeWaitingForFailure + delay
                  }ms`
                );
              }
              timeWaitingForFailure = 0;
              resolve(false);
            } else if (State === "FAILED") {
              // If the query failed because of throttling, continue waiting for a bit
              // Sometimes the query will transition back to a running state
              if (StateChangeReason?.includes("SlowDown")) {
                if (timeWaitingForFailure === 0) {
                  logger.debug(
                    `Athena query (${QueryExecutionId}) received SlowDown error, waiting up to ${retryWaitTime}ms for transition back to running`
                  );
                }

                timeWaitingForFailure += delay;

                if (timeWaitingForFailure >= retryWaitTime) {
                  logger.debug(
                    `Athena query (${QueryExecutionId}) received SlowDown error, has not recovered within ${timeWaitingForFailure}ms, failing query`
                  );
                  reject(new Error(StateChangeReason));
                } else {
                  resolve(false);
                }
              } else {
                reject(new Error(StateChangeReason || "Query failed"));
              }
            } else if (State === "CANCELLED") {
              reject(new Error("Query was cancelled"));
            } else {
              athena
                .getQueryResults({ QueryExecutionId })
                .promise()
                .then(({ ResultSet }) => {
                  if (ResultSet) {
                    resolve(ResultSet);
                  } else {
                    reject("Query did not return results");
                  }
                })
                .catch((e) => {
                  logger.warn(e, "Athena query failed");
                  reject(e);
                });
            }
          })
          .catch((e) => {
            logger.warn(e, "Athena query failed");
            reject(e);
          });
      }, delay);
    });
  };

  // Check for results with an exponential back-off
  // Max time waiting = ~30 minutes
  for (let i = 0; i < 62; i++) {
    const result = await waitAndCheck(500 * Math.pow(1.1, i));
    if (result && result.Rows && result.ResultSetMetadata?.ColumnInfo) {
      const keys = result.ResultSetMetadata.ColumnInfo.map((info) => info.Name);
      return {
        rows: result.Rows.slice(1).map((row) => {
          // eslint-disable-next-line
          const obj: any = {};
          if (row.Data) {
            row.Data.forEach((value, i) => {
              obj[keys[i]] = value.VarCharValue || null;
            });
          }
          return obj;
        }),
      };
    }
  }

  // Cancel the query if it reaches this point
  await athena.stopQueryExecution({ QueryExecutionId }).promise();
  throw new Error("Query timed out after 30 minutes");
}
