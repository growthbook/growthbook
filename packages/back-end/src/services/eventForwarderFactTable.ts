import { BigQueryConnectionParams } from "shared/types/integrations/bigquery";
import { SnowflakeConnectionParams } from "shared/types/integrations/snowflake";
import {
  BigQueryEventForwarderStoredConfig,
  SnowflakeEventForwarderStoredConfig,
} from "shared/types/event-forwarder";
import { EventForwarderConfigInterface } from "shared/validators";
import {
  buildEventForwarderEventsFactTableColumns,
  buildEventForwarderEventsFactTableSql,
  getEventForwarderEventsFactTableId,
  getEventForwarderEventsFactTableIdWithCollisionSuffix,
  getEventForwarderEventsFactTableName,
  isEventForwarderEventsFactTableCandidate,
} from "shared/util";
import type { FactTableInterface } from "shared/types/fact-table";
import type { DataSourceInterface } from "shared/types/datasource";
import {
  createFactTable,
  getFactTable,
  getFactTablesForDatasource,
  deleteFactTable,
} from "back-end/src/models/FactTableModel";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import {
  decryptEventForwarderConfigModel,
  getEventForwarderSinkTypeForDatasource,
} from "back-end/src/services/eventForwarderConfig";
import {
  queueFactTableColumnsRefresh,
  queueFactTableColumnsRefreshAt,
} from "back-end/src/jobs/refreshFactTableColumns";
import { logger } from "back-end/src/util/logger";
import { ReqContext } from "back-end/types/request";

export function findEventForwarderEventsFactTableForDatasource(
  factTables: FactTableInterface[],
  datasourceName: string,
): FactTableInterface | null {
  return (
    factTables.find((ft) =>
      isEventForwarderEventsFactTableCandidate(ft, datasourceName),
    ) ?? null
  );
}

async function resolveEventForwarderEventsFactTableId(
  context: ReqContext,
  datasource: DataSourceInterface,
): Promise<{ factTableId: string; existing: FactTableInterface | null }> {
  const baseId = getEventForwarderEventsFactTableId(datasource.name);
  const existing = await getFactTable(context, baseId);
  if (!existing || existing.datasource === datasource.id) {
    return { factTableId: baseId, existing };
  }

  const factTableId = getEventForwarderEventsFactTableIdWithCollisionSuffix(
    datasource.name,
    datasource.id,
  );
  return {
    factTableId,
    existing: await getFactTable(context, factTableId),
  };
}

async function findEventForwarderEventsFactTableForDatasourceId(
  context: ReqContext,
  datasource: DataSourceInterface,
): Promise<FactTableInterface | null> {
  const factTables = await getFactTablesForDatasource(context, datasource.id);
  let factTable = findEventForwarderEventsFactTableForDatasource(
    factTables,
    datasource.name,
  );

  if (!factTable) {
    const fallbackId = getEventForwarderEventsFactTableId(datasource.name);
    factTable = await getFactTable(context, fallbackId);
    if (factTable?.datasource !== datasource.id) {
      factTable = null;
    }
  }

  return factTable;
}

export async function queueEventForwarderEventsFactTablesColumnsRefresh(
  context: ReqContext,
): Promise<void> {
  const configs = await context.models.eventForwarderConfigs.getAll();
  const datasourceIds = new Set(configs.map((config) => config.datasourceId));

  for (const datasourceId of datasourceIds) {
    const datasource = await getDataSourceById(context, datasourceId);
    if (!datasource) {
      continue;
    }

    const factTable = await findEventForwarderEventsFactTableForDatasourceId(
      context,
      datasource,
    );
    if (!factTable) {
      continue;
    }

    await queueFactTableColumnsRefresh(factTable);
  }
}

const EVENT_FORWARDER_FACT_TABLE_REFRESH_DELAY_MS = 5 * 60 * 1000;

export async function queueDelayedFactTableColumnsRefreshForDatasource(
  context: ReqContext,
  datasourceId: string,
  delayMs = EVENT_FORWARDER_FACT_TABLE_REFRESH_DELAY_MS,
): Promise<void> {
  const factTables = await getFactTablesForDatasource(context, datasourceId);
  const runAt = new Date(Date.now() + delayMs);

  for (const factTable of factTables) {
    await queueFactTableColumnsRefreshAt(factTable, runAt);
  }
}

export async function queueDelayedFactTableColumnsRefreshForEventForwarderDatasources(
  context: ReqContext,
  delayMs = EVENT_FORWARDER_FACT_TABLE_REFRESH_DELAY_MS,
): Promise<void> {
  const configs = await context.models.eventForwarderConfigs.getAll();
  const datasourceIds = new Set(configs.map((config) => config.datasourceId));
  const runAt = new Date(Date.now() + delayMs);

  for (const datasourceId of datasourceIds) {
    const factTables = await getFactTablesForDatasource(context, datasourceId);
    for (const factTable of factTables) {
      await queueFactTableColumnsRefreshAt(factTable, runAt);
    }
  }
}

export async function ensureEventForwarderEventsFactTable(
  context: ReqContext,
  eventForwarderConfig: EventForwarderConfigInterface,
  datasourceParams?: BigQueryConnectionParams | SnowflakeConnectionParams,
): Promise<void> {
  const datasource = await getDataSourceById(
    context,
    eventForwarderConfig.datasourceId,
  );
  if (!datasource) {
    return;
  }

  const { factTableId, existing } =
    await resolveEventForwarderEventsFactTableId(context, datasource);
  if (existing?.datasource === datasource.id) {
    return;
  }

  const userIdTypes =
    datasource.settings?.userIdTypes?.map((u) => u.userIdType) ?? [];
  if (userIdTypes.length === 0) {
    logger.warn(
      {
        datasourceId: datasource.id,
        organizationId: context.org.id,
      },
      "Skipping event forwarder Events fact table: no userIdTypes on datasource",
    );
    return;
  }

  let sql: string;
  switch (eventForwarderConfig.sinkType) {
    case "bigquery": {
      const bigqueryParams = datasourceParams as
        | BigQueryConnectionParams
        | undefined;
      const projectId =
        bigqueryParams?.defaultProject?.trim() ||
        bigqueryParams?.projectId?.trim() ||
        "";
      if (!projectId) {
        logger.warn(
          {
            datasourceId: datasource.id,
            organizationId: context.org.id,
          },
          "Skipping event forwarder Events fact table: missing BigQuery project id",
        );
        return;
      }

      const decrypted =
        decryptEventForwarderConfigModel<BigQueryEventForwarderStoredConfig>(
          eventForwarderConfig,
        );

      sql = buildEventForwarderEventsFactTableSql({
        sinkType: "bigquery",
        projectId,
        dataset: decrypted.dataset.trim(),
        tableName: decrypted.tableName.trim(),
      });
      break;
    }
    case "snowflake": {
      const decrypted =
        decryptEventForwarderConfigModel<SnowflakeEventForwarderStoredConfig>(
          eventForwarderConfig,
        );

      sql = buildEventForwarderEventsFactTableSql({
        sinkType: "snowflake",
        database: decrypted.database.trim(),
        schema: decrypted.schema.trim(),
        tableName: decrypted.tableName.trim(),
      });
      break;
    }
    default:
      throw new Error(
        `Unsupported event forwarder sink type for Events fact table: ${String(eventForwarderConfig.sinkType)}`,
      );
  }

  const columns = buildEventForwarderEventsFactTableColumns(userIdTypes);

  const factTable = await createFactTable(context, {
    id: factTableId,
    name: getEventForwarderEventsFactTableName(datasource.name),
    description: "",
    owner: "",
    tags: [],
    projects: datasource.projects ?? [],
    datasource: datasource.id,
    userIdTypes,
    sql,
    eventName: "",
    columns,
    managedBy: "api",
  });

  await queueFactTableColumnsRefresh(factTable);
}

export async function deleteEventForwarderEventsFactTableForDatasource(
  context: ReqContext,
  datasource: DataSourceInterface,
): Promise<void> {
  // Only invoked from deleteDatasource — not from event forwarder teardown.
  // TODO(event-forwarder): if we ever delete managed exposure/featureUsage
  // queries on forwarder disconnect, keep fact table cleanup aligned with that policy.
  const sinkType = getEventForwarderSinkTypeForDatasource(datasource);
  if (sinkType !== "bigquery" && sinkType !== "snowflake") {
    return;
  }

  const factTable = await findEventForwarderEventsFactTableForDatasourceId(
    context,
    datasource,
  );

  if (!factTable) {
    return;
  }

  await deleteFactTable(context, factTable, { bypassManagedByCheck: true });
}
