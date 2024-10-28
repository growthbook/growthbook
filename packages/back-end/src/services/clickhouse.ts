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
  // Temporary protection to prevent users from manually changing feature flag to create Clickhouse users.
  if (ENVIRONMENT === "production" && context.org.id != "org_24yyifrkf649iz6") {
    throw new Error(
      "Clickhouse user creation is only allowed for the Growthbook organization"
    );
  }

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

  logger.info(`Creating Clickhouse view ${viewName}`);
  await client.command({
    query: `CREATE VIEW ${viewName} DEFINER=CURRENT_USER SQL SECURITY DEFINER AS SELECT * FROM ${CLICKHOUSE_MAIN_TABLE} WHERE organization = '${orgId}'`,
  });

  logger.info(`Granting select permissions on ${viewName} to ${user}`);
  await client.command({ query: `GRANT SELECT ON ${viewName} TO ${user}` });

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
