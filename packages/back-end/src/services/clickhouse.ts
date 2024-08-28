import { createClient } from "@clickhouse/client";
import { ClickHouseConnectionParams } from "@back-end/types/integrations/clickhouse";
import { getHost } from "../util/sql";

export function getClickHouseClient(params: ClickHouseConnectionParams) {
  return createClient({
    host: getHost(params.url, params.port),
    username: params.username,
    password: params.password,
    database: params.database,
    application: "GrowthBook",
    request_timeout: 3620_000,
    clickhouse_settings: {
      max_execution_time: Math.min(params.maxExecutionTime ?? 1800, 3600),
    },
  });
}

export async function createClickHouseDatabaseForParams(
  params: ClickHouseConnectionParams,
  initDB: string
) {
  const client = getClickHouseClient({
    ...params,
    database: initDB,
  });
  const sql = `CREATE DATABASE IF NOT EXISTS ${params.database}`;
  await client.command({ query: sql });
}
