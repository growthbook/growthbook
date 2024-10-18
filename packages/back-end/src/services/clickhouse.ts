import * as crypto from "crypto";
import { createClient as createClickhouseClient } from "@clickhouse/client";
import generator from "generate-password";
import {
  CLICKHOUSE_HOST,
  CLICKHOUSE_ADMIN_USER,
  CLICKHOUSE_ADMIN_PASSWORD,
  CLICKHOUSE_DATABASE,
  CLICKHOUSE_MAIN_TABLE,
} from "back-end/src/util/secrets";
import { DataSourceParams } from "back-end/types/datasource";
import { ReqContext } from "back-end/types/organization";
import { logger } from "back-end/src/util/logger";

export async function createClickhouseUser(
  context: ReqContext
): Promise<DataSourceParams> {
  const client = createClickhouseClient({
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

  const orgId = context.org.id;
  const user = orgId;
  const password = generator.generate({
    length: 30,
    numbers: true,
  });
  const hashedPassword = crypto
    .createHash("sha256")
    .update(password)
    .digest("hex");

  const database = orgId;
  const viewName = `${database}.events`;

  logger.info(`creating Clickhouse database ${database}`);
  await client.command({
    query: `CREATE DATABASE ${database}`,
  });

  logger.info(`Creating Clickhouse user ${user}`);
  await client.command({
    query: `CREATE USER ${user} IDENTIFIED WITH sha256_hash BY '${hashedPassword}'`,
  });

  logger.info(`Creating Clickhouse view ${viewName}`);
  await client.command({
    query: `CREATE VIEW ${viewName} DEFINER=CURRENT_USER SQL SECURITY DEFINER AS SELECT * FROM ${CLICKHOUSE_MAIN_TABLE} WHERE organization = '${orgId}'`,
  });

  logger.info(`Granting select permissions on ${viewName} to ${user}`);
  await client.command({ query: `GRANT SELECT ON ${viewName} TO ${user}` });

  logger.info(`Clickhouse user ${user} created`);

  const parts = CLICKHOUSE_HOST.split(":");
  const port = parseInt(CLICKHOUSE_HOST.split(":").pop() || "9000");
  const url = parts.join(":");

  const params = {
    port: port,
    url: url,
    user: user,
    password: password,
    database: database,
  };

  return params;
}

export async function deleteClickhouseUser(organization: string) {
  const client = createClickhouseClient({
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

  logger.info(`Deleting Clickhouse user ${organization}`);
  await client.command({
    query: `DROP USER ${organization}`,
  });

  logger.info(`Deleting Clickhouse database ${organization}`);
  await client.command({
    query: `DROP DATABASE ${organization}`,
  });

  logger.info(`Clickhouse user ${organization} deleted`);
}
