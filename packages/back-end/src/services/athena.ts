import { Athena } from "aws-sdk";
import { ResultSet } from "aws-sdk/clients/athena";
import { AthenaConnectionParams } from "../../types/integrations/athena";

export async function runAthenaQuery<T>(
  conn: AthenaConnectionParams,
  sql: string
): Promise<T[]> {
  const {
    database,
    bucketUri,
    workGroup,
    accessKeyId,
    secretAccessKey,
    region,
  } = conn;

  const athena = new Athena({
    accessKeyId,
    secretAccessKey,
    region,
  });

  const { QueryExecutionId } = await athena
    .startQueryExecution({
      QueryString: sql,
      QueryExecutionContext: {
        Database: database,
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

  const waitAndCheck = () => {
    return new Promise<false | ResultSet>((resolve, reject) => {
      setTimeout(() => {
        athena
          .getQueryExecution({ QueryExecutionId })
          .promise()
          .then((resp) => {
            const {
              QueryExecution: {
                Status: { State, StateChangeReason },
              },
            } = resp;
            if (State === "RUNNING") {
              resolve(false);
            } else if (State === "FAILED") {
              reject(new Error(StateChangeReason));
            } else {
              athena
                .getQueryResults({ QueryExecutionId })
                .promise()
                .then(({ ResultSet }) => {
                  resolve(ResultSet);
                })
                .catch((e) => {
                  console.error(e);
                  reject(e);
                });
            }
          })
          .catch((e) => {
            console.error(e);
            reject(e);
          });
      }, 500);
    });
  };

  // Timeout after 300 seconds
  for (let i = 0; i < 600; i++) {
    const result = await waitAndCheck();
    if (result) {
      const keys = result.ResultSetMetadata.ColumnInfo.map((info) => info.Name);
      return result.Rows.slice(1).map((row) => {
        // eslint-disable-next-line
        const obj: any = {};
        row.Data.forEach((value, i) => {
          obj[keys[i]] = value.VarCharValue || null;
        });
        return obj;
      });
    }
  }

  // Cancel the query if it reaches this point
  await athena.stopQueryExecution({ QueryExecutionId }).promise();
  throw new Error("Query timed out after 5 minutes");
}
