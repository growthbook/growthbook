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
): Promise<string> {
  const baseId = getEventForwarderEventsFactTableId(datasource.name);
  const existing = await getFactTable(context, baseId);
  if (!existing || existing.datasource === datasource.id) {
    return baseId;
  }

  return getEventForwarderEventsFactTableIdWithCollisionSuffix(
    datasource.name,
    datasource.id,
  );
}

export async function ensureEventForwarderEventsFactTable(
  context: ReqContext,
  eventForwarderConfig: EventForwarderConfigInterface,
  datasourceParams?: BigQueryConnectionParams | SnowflakeConnectionParams,
): Promise<void> {
  if (eventForwarderConfig.sinkType === "databricks") {
    return;
  }

  const datasource = await getDataSourceById(
    context,
    eventForwarderConfig.datasourceId,
  );
  if (!datasource) {
    return;
  }

  const factTableId = await resolveEventForwarderEventsFactTableId(
    context,
    datasource,
  );
  const existing = await getFactTable(context, factTableId);
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

  const attributeSchema = context.org.settings?.attributeSchema ?? [];

  let sql: string;
  if (eventForwarderConfig.sinkType === "bigquery") {
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
  } else if (eventForwarderConfig.sinkType === "snowflake") {
    const decrypted =
      decryptEventForwarderConfigModel<SnowflakeEventForwarderStoredConfig>(
        eventForwarderConfig,
      );

    sql = buildEventForwarderEventsFactTableSql({
      sinkType: "snowflake",
      database: decrypted.database.trim(),
      schema: decrypted.schema.trim(),
      tableName: decrypted.tableName.trim(),
      userIdTypes,
    });
  } else {
    return;
  }

  const columns = buildEventForwarderEventsFactTableColumns(
    userIdTypes,
    attributeSchema,
    datasource.projects,
  );

  await createFactTable(context, {
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
}

export async function deleteEventForwarderEventsFactTableForDatasource(
  context: ReqContext,
  datasource: DataSourceInterface,
): Promise<void> {
  const sinkType = getEventForwarderSinkTypeForDatasource(datasource);
  if (sinkType !== "bigquery" && sinkType !== "snowflake") {
    return;
  }

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

  if (!factTable) {
    return;
  }

  await deleteFactTable(context, factTable, { bypassManagedByCheck: true });
}
