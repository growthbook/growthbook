import { createClient as createClickhouseClient } from "@clickhouse/client";
import { AIPromptType } from "shared/ai";
import { MANAGED_WAREHOUSE_EVENTS_FACT_TABLE_ID } from "shared/constants";
import {
  isManagedWarehouseAwaitingProvisioning,
  parseIntWithDefault,
} from "shared/util";
import {
  GrowthbookClickhouseDataSource,
  MaterializedColumn,
} from "shared/types/datasource";
import { DailyUsage } from "shared/types/organization";
import {
  CLICKHOUSE_HOST,
  CLICKHOUSE_ADMIN_USER,
  CLICKHOUSE_ADMIN_PASSWORD,
  CLICKHOUSE_DATABASE,
  CLICKHOUSE_MAIN_TABLE,
  ENVIRONMENT,
  IS_CLOUD,
  CLICKHOUSE_OVERAGE_TABLE,
} from "back-end/src/util/secrets";
import type { ReqContext } from "back-end/types/request";
import { logger } from "back-end/src/util/logger";
import {
  getFactTablesForDatasource,
  updateFactTableColumns,
} from "back-end/src/models/FactTableModel";
import { updateMaterializedColumnsInClickhouse } from "back-end/src/services/licenseServerManagedClickhouse";

type ClickHouseDataType =
  | "DateTime"
  | "Float64"
  | "Boolean"
  | "String"
  | "LowCardinality(String)";

const REMAINING_COLUMNS_SCHEMA: Record<string, ClickHouseDataType> = {
  environment: "LowCardinality(String)",
  sdk_language: "LowCardinality(String)",
  sdk_version: "LowCardinality(String)",
  event_uuid: "String",
  ip: "String",
};

function ensureClickhouseEnvVars() {
  if (
    !CLICKHOUSE_HOST ||
    !CLICKHOUSE_ADMIN_USER ||
    !CLICKHOUSE_ADMIN_PASSWORD ||
    !CLICKHOUSE_DATABASE ||
    !CLICKHOUSE_MAIN_TABLE
  ) {
    throw new Error(
      "Must specify necessary environment variables to interact with clickhouse.",
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

export function getReservedColumnNames(): Set<string> {
  return new Set(
    [
      "timestamp",
      "client_key",
      "event_name",
      "properties",
      "attributes",
      "experiment_id",
      "variation_id",
      ...Object.keys(REMAINING_COLUMNS_SCHEMA),
    ].map((col) => col.toLowerCase()),
  );
}

// In order to monitor usage and quality of AI responses on cloud we log each request to AI agents
export async function logCloudAIUsage({
  organization,
  type,
  model,
  temperature,
  numPromptTokensUsed,
  numCompletionTokensUsed,
  usedDefaultPrompt,
}: {
  organization: string;
  model: string;
  numPromptTokensUsed?: number;
  numCompletionTokensUsed?: number;
  type: AIPromptType;
  temperature?: number;
  usedDefaultPrompt: boolean;
}): Promise<void> {
  if (!IS_CLOUD) {
    // This is only for cloud
    return;
  }

  const env = ENVIRONMENT === "production" ? "prod" : ENVIRONMENT;
  // As this is just for logging, there is no need to make this a fatal error if it fails
  try {
    const client = createAdminClickhouseClient();
    await client.insert({
      table: "usage.ai_usage",
      values: [
        {
          env,
          organization,
          type,
          model,
          num_prompt_tokens_used: numPromptTokensUsed,
          num_completion_tokens_used: numCompletionTokensUsed,
          temperature,
          used_default_prompt: usedDefaultPrompt,
          date_created: new Date(),
        },
      ],
      format: "JSONEachRow",
    });
  } catch (e) {
    logger.error(e, "Failed to log AI usage to Clickhouse");
  }
}

export async function getDailyUsageForOrg(
  orgId: string,
  start: Date,
  end: Date,
): Promise<DailyUsage[]> {
  const client = createAdminClickhouseClient();

  // orgId is coming from the back-end, so this should not be necessary, but just in case
  const sanitizedOrgId = orgId.replace(/[^a-zA-Z0-9_-]/g, "");

  const startString = start.toISOString().replace("T", " ").substring(0, 19);
  const endString = end.toISOString().replace("T", " ").substring(0, 19);

  // Don't fill forward beyond the current date
  const fillEnd = end > new Date() ? new Date() : end;
  const fillEndString = fillEnd
    .toISOString()
    .replace("T", " ")
    .substring(0, 19);

  const sql = `
select
  date,
  sum(requests) as requests,
  sum(bandwidth) as bandwidth,
  sum(managedClickhouseEvents) as managedClickhouseEvents
from (
  select
    toStartOfDay(hour) as date,
    sum(requests) as requests,
    sum(bandwidth) as bandwidth,
    0 as managedClickhouseEvents
  from usage.cdn_hourly
  where
    organization = '${sanitizedOrgId}'
    AND date BETWEEN '${startString}' AND '${endString}'
  group by date
  
  union all
  
  select
    toStartOfDay(received_at) as date,
    0 as requests,
    0 as bandwidth,
    count(1) as managedClickhouseEvents
  from ${CLICKHOUSE_MAIN_TABLE}
  where
    organization = '${sanitizedOrgId}'
    AND received_at BETWEEN '${startString}' AND '${endString}'
  group by date
  
  union all
  
  select
    toStartOfDay(received_at) as date,
    0 as requests,
    0 as bandwidth,
    count(1) as managedClickhouseEvents
  from ${CLICKHOUSE_OVERAGE_TABLE}
  where
    organization = '${sanitizedOrgId}'
    AND received_at BETWEEN '${startString}' AND '${endString}'
  group by date
)
group by date
order by date ASC
WITH FILL
  FROM toDateTime('${startString}')
  TO toDateTime('${fillEndString}')
  STEP toIntervalDay(1)
  `.trim();

  const res = await client.query({
    query: sql,
    format: "JSONEachRow",
  });

  const data: {
    date: string;
    // These are returned as strings because they could in theory be bigger than MAX_SAFE_INTEGER
    // That is very unlikely, and even if it happens it will still be approximately correct
    requests: string;
    bandwidth: string;
    managedClickhouseEvents: string;
  }[] = await res.json();

  // Convert strings to numbers for all metrics
  return data.map((d) => ({
    date: d.date,
    requests: parseIntWithDefault(d.requests, 0),
    bandwidth: parseIntWithDefault(d.bandwidth, 0),
    managedClickhouseEvents: parseIntWithDefault(d.managedClickhouseEvents, 0),
  }));
}

export async function updateMaterializedColumns({
  context,
  datasource,
  columnsToAdd,
  columnsToDelete,
  columnsToRename,
  finalColumns,
  originalColumns,
}: {
  context: ReqContext;
  datasource: GrowthbookClickhouseDataSource;
  columnsToAdd: MaterializedColumn[];
  columnsToDelete: string[];
  columnsToRename: { from: string; to: string }[];
  finalColumns: MaterializedColumn[];
  originalColumns: MaterializedColumn[];
}) {
  if (isManagedWarehouseAwaitingProvisioning(datasource)) {
    return;
  }
  const orgId = datasource.organization;

  await updateMaterializedColumnsInClickhouse({
    orgId,
    columnsToAdd,
    columnsToDelete,
    columnsToRename,
    finalColumns,
    originalColumns,
  });

  // Update the main events fact table with the new columns
  const factTables = await getFactTablesForDatasource(context, datasource.id);
  const ft = factTables.find(
    (ft) => ft.id === MANAGED_WAREHOUSE_EVENTS_FACT_TABLE_ID,
  );
  if (ft) {
    const newColumns = [...ft.columns];
    newColumns.forEach((col) => {
      if (col.numberFormat === undefined) {
        col.numberFormat = "";
      }
    });

    columnsToAdd.forEach((col) => {
      const existingCol = newColumns.find((c) => c.column === col.columnName);
      if (!existingCol) {
        newColumns.push({
          column: col.columnName,
          name: col.columnName,
          datatype: col.datatype,
          dateCreated: new Date(),
          dateUpdated: new Date(),
          deleted: false,
          description: "",
          numberFormat: "",
        });
      } else {
        // If the column already exists but was previously removed, restore it.
        existingCol.deleted = false;
        existingCol.dateUpdated = new Date();
      }
    });
    columnsToRename.forEach(({ from, to }) => {
      const col = newColumns.find((c) => c.column === from);
      if (col) {
        const existingDestinationCol = newColumns.find((c) => c.column === to);
        // Destination already exists
        if (existingDestinationCol) {
          // Restore destination if it had been previously removed.
          existingDestinationCol.deleted = false;
          existingDestinationCol.dateUpdated = new Date();
          // Mark the old column as deleted.
          col.deleted = true;
          col.dateUpdated = new Date();
        } else {
          // Otherwise, rename in place
          col.column = to;
          col.name = to;
          col.dateUpdated = new Date();
        }
      }
    });
    columnsToDelete.forEach((name) => {
      const col = newColumns.find((c) => c.column === name);
      if (col) {
        col.deleted = true;
        col.dateUpdated = new Date();
      }
    });

    const newIdentifierTypes = finalColumns
      .filter((col) => col.type === "identifier")
      .map((col) => col.columnName);

    await updateFactTableColumns(
      ft,
      { columns: newColumns, userIdTypes: newIdentifierTypes },
      context,
    );
  }
}
