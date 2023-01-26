import { DBSQLClient } from "@databricks/sql";
import { DatabricksConnectionParams } from "../../types/integrations/databricks";

export async function runDatabricksQuery<T>(
  conn: DatabricksConnectionParams,
  sql: string
): Promise<T[]> {
  const client = new DBSQLClient();

  await client.connect({
    token: conn.token,
    host: conn.host,
    port: conn.port || 443,
    path: conn.path,
  });

  const session = await client.openSession();

  const queryOperation = await session.executeStatement(sql, {
    runAsync: true,
    // This is required to have the results returned immediately
    maxRows: 1000,
  });

  const result = ((await queryOperation.fetchAll({
    progress: false,
  })) as unknown) as Promise<T[]>;

  await queryOperation.close();
  await session.close();
  await client.close();

  return result;
}
