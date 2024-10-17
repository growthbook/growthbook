import * as crypto from "crypto";
import { createClient as createClickhouseClient } from "@clickhouse/client";
import {
  CLICKHOUSE_HOST,
  CLICKHOUSE_ADMIN_USER,
  CLICKHOUSE_ADMIN_PASSWORD,
  CLICKHOUSE_DATABASE,
} from "back-end/src/util/secrets";
import { DataSourceParams } from "back-end/types/datasource";
import { ReqContext } from "back-end/types/organization";
import { logger } from "back-end/src/util/logger";

function generatePassword(length: number = 16): string {
  const uppercaseChars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const specialChars = "!@#$%^&*()_+[]{}|;:,.<>?";
  const numericChars = "0123456789";
  const allChars =
    "abcdefghijklmnopqrstuvwxyz" + uppercaseChars + numericChars + specialChars;

  let password = "";
  password += uppercaseChars[Math.floor(Math.random() * uppercaseChars.length)];
  password += specialChars[Math.floor(Math.random() * specialChars.length)];
  password += numericChars[Math.floor(Math.random() * numericChars.length)];

  for (let i = 3; i < length; i++) {
    password += allChars[Math.floor(Math.random() * allChars.length)];
  }

  return password
    .split("")
    .sort(() => 0.5 - Math.random())
    .join("");
}

export async function createClickhouseUser(
  context: ReqContext
): Promise<DataSourceParams> {
  const eventsTableName = "test_enriched_events";
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
  const password = generatePassword();
  const hashedPassword = crypto
    .createHash("sha256")
    .update(password)
    .digest("hex");

  const viewName = `events_${orgId}`;

  logger.info(`Creating Clickhouse user ${user} and password ${password}`);
  await client.command({
    query: `CREATE USER ${user} IDENTIFIED WITH sha256_hash BY '${hashedPassword}'`,
  });

  logger.info(`Creating Clickhouse view ${viewName}`);
  await client.command({
    query: `CREATE MATERIALIZED VIEW ${viewName} ENGINE = MergeTree() ORDER BY organization DEFINER=CURRENT_USER SQL SECURITY DEFINER AS SELECT * FROM ${eventsTableName} WHERE organization = '${orgId}'`,
  });

  // Materialized views only show rows that have been added since the view was created
  // We probably don't need to do this for real, but during testing we need to populate it with existing data
  logger.info(`Populating view with existing data`);
  await client.command({
    query: `INSERT INTO ${viewName} SELECT * FROM ${eventsTableName} WHERE organization = '${orgId}'`,
  });

  logger.info(`Granting select permissions on ${viewName} to ${user}`);
  await client.command({ query: `GRANT SELECT ON ${viewName} TO ${user}` });

  // The above permission is good enough for the user to use the materialized view going forward.  Alternatively we can create a row policy
  // and grant select on the main table.  They can read off the main table, but the row policy will restrict them to only seeing their org's data.
  logger.info("Creating row policy");
  await client.command({
    query: `CREATE ROW POLICY IF NOT EXISTS ${viewName}_policy ON ${eventsTableName} FOR SELECT USING organization = '${orgId}' TO '${user}'`,
  });

  logger.info(
    `Granting select permissions on main table to ${user} which should be safe because of the row policy`
  );
  await client.command({
    query: `GRANT SELECT ON ${eventsTableName} TO ${user}`,
  });

  logger.info(`Clickhouse user ${user} created`);

  const parts = CLICKHOUSE_HOST.split(":");
  const port = parseInt(CLICKHOUSE_HOST.split(":").pop() || "9000");
  const url = parts.join(":");

  const params = {
    port: port,
    url: url,
    user: user,
    password: password,
    database: CLICKHOUSE_DATABASE,
  };

  return params;
}
