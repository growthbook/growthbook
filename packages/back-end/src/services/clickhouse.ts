import * as crypto from "crypto";
import { createClient as createClickhouseClient } from "@clickhouse/client";
import generator from "generate-password";
import {
  CLICKHOUSE_HOST,
  CLICKHOUSE_ADMIN_USER,
  CLICKHOUSE_ADMIN_PASSWORD,
  CLICKHOUSE_DATABASE,
  CLICKHOUSE_MAIN_TABLE,
  ENVIRONMENT,
} from "back-end/src/util/secrets";
import { DataSourceParams } from "back-end/types/datasource";
import { ReqContext } from "back-end/types/organization";
import { logger } from "back-end/src/util/logger";

function clickhouseUserId(orgId: string, datasourceId: string) {
  return ENVIRONMENT === "production"
    ? `${orgId}_${datasourceId}`
    : `test_${orgId}_${datasourceId}`;
}

function ensureClickhouseEnvVars() {
  if (
    !CLICKHOUSE_HOST ||
    !CLICKHOUSE_ADMIN_USER ||
    !CLICKHOUSE_ADMIN_PASSWORD ||
    !CLICKHOUSE_DATABASE ||
    !CLICKHOUSE_MAIN_TABLE
  ) {
    throw new Error(
      "Must specify necessary environment variables to interact with clickhouse."
    );
  }
}

function createAdminClickhouseClient() {
  ensureClickhouseEnvVars();
  return createClickhouseClient({
    host: CLICKHOUSE_HOST,
    username: CLICKHOUSE_ADMIN_USER,
    password: CLICKHOUSE_ADMIN_PASSWORD,
    database: CLICKHOUSE_DATABASE,
    application: "GrowthBook",
    request_timeout: 3620_000,
    clickhouse_settings: {
      max_execution_time: 3600,
    },
  });
}

export async function createClickhouseUser(
  context: ReqContext,
  datasourceId: string
): Promise<DataSourceParams> {
  const client = createAdminClickhouseClient();

  const orgId = context.org.id;
  const user = clickhouseUserId(orgId, datasourceId);
  const password = generator.generate({
    length: 30,
    numbers: true,
  });
  const hashedPassword = crypto
    .createHash("sha256")
    .update(password)
    .digest("hex");

  const database = user;
  const viewName = `${database}.events`;

  logger.info(`creating Clickhouse database ${database}`);
  await client.command({
    query: `CREATE DATABASE ${database}`,
  });

  logger.info(`Creating Clickhouse user ${user}`);
  await client.command({
    query: `CREATE USER ${user} IDENTIFIED WITH sha256_hash BY '${hashedPassword}' DEFAULT DATABASE ${database}`,
  });

  logger.info(`Creating Clickhouse materialized view ${viewName}`);
  await client.command({
    query: `CREATE MATERIALIZED VIEW ${viewName} 
ENGINE = MergeTree
PARTITION BY toYYYYMM(timestamp) 
ORDER BY timestamp
DEFINER=CURRENT_USER SQL SECURITY DEFINER
AS SELECT 
    timestamp,
    client_key,
    event_name,
    properties_json,
    user_id,
    context_json,
    url,
    url_path,
    url_host,
    url_query,
    url_fragment,
    device_id,
    page_id,
    session_id,
    sdk_language,
    sdk_version,
    page_title,
    utm_source,
    utm_medium,
    utm_campaign,
    utm_term,
    utm_content,
    event_uuid,
    ip,
    geo_country,
    geo_city,
    geo_lat,
    geo_lon,
    ua,
    ua_browser,
    ua_os,
    ua_device_type
FROM ${CLICKHOUSE_MAIN_TABLE} 
WHERE organization = '${orgId}';`,
  });

  logger.info(`Copying existing data to the materialized view`);
  await client.command({
    query: `INSERT INTO ${viewName} SELECT
    timestamp,
    client_key,
    event_name,
    properties_json,
    user_id,
    context_json,
    url,
    url_path,
    url_host,
    url_query,
    url_fragment,
    device_id,
    page_id,
    session_id,
    sdk_language,
    sdk_version,
    page_title,
    utm_source,
    utm_medium,
    utm_campaign,
    utm_term,
    utm_content,
    event_uuid,
    ip,
    geo_country,
    geo_city,
    geo_lat,
    geo_lon,
    ua,
    ua_browser,
    ua_os,
    ua_device_type
FROM ${CLICKHOUSE_MAIN_TABLE}
WHERE organization = '${orgId}';`,
  });

  logger.info(`Granting select permissions on ${viewName} to ${user}`);
  await client.command({ query: `GRANT SELECT ON ${viewName} TO ${user}` });

  logger.info(
    `Granting select permissions on information_schema.columns to ${user}`
  );
  // For schema browser.  They can only see info on tables that they have select permissions on.
  await client.command({
    query: `GRANT SELECT(data_type, table_name, table_catalog, table_schema, column_name) ON information_schema.columns TO ${user}`,
  });

  logger.info(`Clickhouse user ${user} created`);

  const url = new URL(CLICKHOUSE_HOST);

  const params = {
    port: parseInt(url.port) || 9000,
    url: url.toString(),
    user: user,
    password: password,
    database: database,
  };

  return params;
}

export async function deleteClickhouseUser(
  datasourceId: string,
  organization: string
) {
  const client = createAdminClickhouseClient();
  const user = clickhouseUserId(organization, datasourceId);

  logger.info(`Deleting Clickhouse user ${user}`);
  await client.command({
    query: `DROP USER ${user}`,
  });

  logger.info(`Deleting Clickhouse database ${user}`);
  await client.command({
    query: `DROP DATABASE ${user}`,
  });

  logger.info(`Clickhouse user ${user} deleted`);
}
