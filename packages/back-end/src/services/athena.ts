import { STSClient, AssumeRoleCommand } from "@aws-sdk/client-sts";
import {
  Athena,
  ResultSet,
  StartQueryExecutionCommandInput,
} from "@aws-sdk/client-athena";
import { ExternalIdCallback, QueryResponse } from "shared/types/integrations";
import { AthenaConnectionParams } from "shared/types/integrations/athena";
import { logger } from "back-end/src/util/logger";
import { IS_CLOUD } from "back-end/src/util/secrets";

async function assumeRole(params: AthenaConnectionParams) {
  // build sts client
  const client = new STSClient();
  const command = new AssumeRoleCommand({
    RoleArn: params.assumeRoleARN,
    RoleSessionName: params.roleSessionName,
    ExternalId: params.externalId,
    DurationSeconds: params.durationSeconds,
  });

  return await client.send(command);
}

async function getAthenaInstance(params: AthenaConnectionParams) {
  // handle the instance profile
  if (!IS_CLOUD && params.authType === "auto") {
    return new Athena({
      region: params.region,
    });
  }

  // handle assuming a role first
  if (!IS_CLOUD && params.authType === "assumeRole") {
    // use client to assume another role
    const credentials = await assumeRole(params);

    return new Athena({
      credentials: {
        accessKeyId: credentials?.Credentials?.AccessKeyId || "",
        secretAccessKey: credentials?.Credentials?.SecretAccessKey || "",
        sessionToken: credentials?.Credentials?.SessionToken || "",
      },
      region: params.region,
    });
  }

  // handle access key + secret key
  return new Athena({
    credentials: {
      accessKeyId: params.accessKeyId || "",
      secretAccessKey: params.secretAccessKey || "",
    },
    region: params.region,
  });
}

export async function cancelAthenaQuery(
  conn: AthenaConnectionParams,
  id: string,
) {
  const athena = await getAthenaInstance(conn);
  await athena.stopQueryExecution({
    QueryExecutionId: id,
  });
}

export async function runAthenaQuery(
  conn: AthenaConnectionParams,
  sql: string,
  setExternalId: ExternalIdCallback,
): Promise<QueryResponse> {
  // AWS Athena has a hard limit of 262,144 characters for the QueryString parameter
  // Fail early to avoid CPU and memory issues on the server
  const MAX_QUERY_LENGTH = 262144;
  if (sql.length > MAX_QUERY_LENGTH) {
    throw new Error(
      `Query string length (${sql.length} characters) exceeds Athena's maximum allowed length of ${MAX_QUERY_LENGTH} characters. Please simplify your query.`,
    );
  }

  const athena = await getAthenaInstance(conn);

  const { database, bucketUri, workGroup, catalog } = conn;

  const retryWaitTime =
    (parseInt(process.env.ATHENA_RETRY_WAIT_TIME || "60") || 60) * 1000;

  const startQueryExecutionArgs: StartQueryExecutionCommandInput = {
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
  };

  const resultReuseMaxAgeInMinutes = conn.resultReuseMaxAgeInMinutes
    ? parseInt(conn.resultReuseMaxAgeInMinutes)
    : undefined;

  // Skipped when parsed setting is 0, NaN, or not present
  if (resultReuseMaxAgeInMinutes) {
    startQueryExecutionArgs.ResultReuseConfiguration = {
      ResultReuseByAgeConfiguration: {
        Enabled: true,
        MaxAgeInMinutes: resultReuseMaxAgeInMinutes,
      },
    };
  }

  const { QueryExecutionId } = await athena.startQueryExecution(
    startQueryExecutionArgs,
  );

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
          .then((resp) => {
            const State = resp.QueryExecution?.Status?.State;
            const StateChangeReason =
              resp.QueryExecution?.Status?.StateChangeReason;

            if (State === "RUNNING" || State === "QUEUED") {
              if (timeWaitingForFailure > 0) {
                logger.debug(
                  `Athena query (${QueryExecutionId}) recovered from SlowDown error in ${
                    timeWaitingForFailure + delay
                  }ms`,
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
                    `Athena query (${QueryExecutionId}) received SlowDown error, waiting up to ${retryWaitTime}ms for transition back to running`,
                  );
                }

                timeWaitingForFailure += delay;

                if (timeWaitingForFailure >= retryWaitTime) {
                  logger.debug(
                    `Athena query (${QueryExecutionId}) received SlowDown error, has not recovered within ${timeWaitingForFailure}ms, failing query`,
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
              obj[keys[i] as string] = value.VarCharValue || null;
            });
          }
          return obj;
        }),
      };
    }
  }

  // Cancel the query if it reaches this point
  await athena.stopQueryExecution({ QueryExecutionId });
  throw new Error("Query timed out after 30 minutes");
}
