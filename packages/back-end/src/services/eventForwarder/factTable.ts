import { BigQueryConnectionParams } from "shared/types/integrations/bigquery";
import { SnowflakeConnectionParams } from "shared/types/integrations/snowflake";
import { SDKAttributeSchema } from "shared/types/organization";
import {
  BigQueryEventForwarderStoredConfig,
  SnowflakeEventForwarderStoredConfig,
} from "shared/types/event-forwarder";
import type {
  ColumnInterface,
  CreateColumnProps,
} from "shared/types/fact-table";
import { EventForwarderConfigInterface } from "shared/validators";
import {
  buildEventForwarderEventsFactTableColumns,
  buildEventForwarderEventsFactTableSql,
  EVENT_FORWARDER_WAREHOUSE_SYNC_DELAY_MS,
  getEventForwarderEventsFactTableId,
  getEventForwarderEventsFactTableName,
  getEventForwarderSinkTypeForDatasource,
} from "shared/util";
import type { DataSourceInterface } from "shared/types/datasource";
import {
  createFactTable,
  getFactTable,
  deleteFactTable,
  updateFactTable,
} from "back-end/src/models/FactTableModel";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import {
  decryptEventForwarderConfigModel,
  getBigQueryEventForwarderTablePrefix,
  getSnowflakeEventForwarderTablePrefix,
} from "back-end/src/services/eventForwarder/config";
import { getSourceIntegrationObject } from "back-end/src/services/datasource";
import {
  queueFactTableColumnsRefresh,
  queueFactTableColumnsRefreshAt,
} from "back-end/src/jobs/refreshFactTableColumns";
import { getContextForAgendaJobByOrgObject } from "back-end/src/services/organizations";
import { logger } from "back-end/src/util/logger";
import { ReqContext } from "back-end/types/request";

export async function getEventForwarderEventsFactTableForDatasource(
  context: ReqContext,
  datasource: DataSourceInterface,
) {
  const factTable = await getFactTable(
    context,
    getEventForwarderEventsFactTableId(datasource.id),
  );
  if (!factTable || factTable.datasource !== datasource.id) {
    return null;
  }
  return factTable;
}

export async function queueEventForwarderEventsFactTablesColumnsRefresh(
  context: ReqContext,
): Promise<void> {
  const configs = await context.models.eventForwarderConfigs.getAll();
  const datasourceIds = new Set(configs.map((config) => config.datasourceId));

  await Promise.all(
    [...datasourceIds].map(async (datasourceId) => {
      const datasource = await getDataSourceById(context, datasourceId);
      if (!datasource) {
        return;
      }

      const factTable = await getEventForwarderEventsFactTableForDatasource(
        context,
        datasource,
      );
      if (!factTable) {
        return;
      }

      await queueFactTableColumnsRefresh(factTable);
    }),
  );
}

export async function queueDelayedFactTableColumnsRefreshForDatasource(
  context: ReqContext,
  datasourceId: string,
  delayMs = EVENT_FORWARDER_WAREHOUSE_SYNC_DELAY_MS,
): Promise<void> {
  const datasource = await getDataSourceById(context, datasourceId);
  if (!datasource) {
    return;
  }

  const factTable = await getEventForwarderEventsFactTableForDatasource(
    context,
    datasource,
  );
  if (!factTable) {
    return;
  }

  await queueFactTableColumnsRefreshAt(
    factTable,
    new Date(Date.now() + delayMs),
  );
}

function buildEventForwarderEventsFactTableSqlForDatasource(
  context: ReqContext,
  eventForwarderConfig: EventForwarderConfigInterface,
  datasource: DataSourceInterface,
  attributeSchema: SDKAttributeSchema,
): string | null {
  switch (eventForwarderConfig.sinkType) {
    case "bigquery": {
      const bigqueryParams = getSourceIntegrationObject(context, datasource)
        .params as BigQueryConnectionParams;
      const projectId =
        bigqueryParams.defaultProject?.trim() ||
        bigqueryParams.projectId?.trim() ||
        "";
      if (!projectId) {
        return null;
      }

      const decrypted =
        decryptEventForwarderConfigModel<BigQueryEventForwarderStoredConfig>(
          eventForwarderConfig,
        );
      return buildEventForwarderEventsFactTableSql({
        sinkType: "bigquery",
        projectId,
        dataset: decrypted.dataset.trim(),
        tablePrefix: getBigQueryEventForwarderTablePrefix(decrypted),
        attributeSchema,
        datasourceProjects: datasource.projects,
        userIdTypes:
          datasource.settings?.userIdTypes?.map((u) => u.userIdType) ?? [],
      });
    }
    case "snowflake": {
      const decrypted =
        decryptEventForwarderConfigModel<SnowflakeEventForwarderStoredConfig>(
          eventForwarderConfig,
        );
      return buildEventForwarderEventsFactTableSql({
        sinkType: "snowflake",
        database: decrypted.database.trim(),
        schema: decrypted.schema.trim(),
        tablePrefix: getSnowflakeEventForwarderTablePrefix(decrypted),
        attributeSchema,
        datasourceProjects: datasource.projects,
        userIdTypes:
          datasource.settings?.userIdTypes?.map((u) => u.userIdType) ?? [],
      });
    }
    default:
      return null;
  }
}

export async function syncEventForwarderEventsFactTableMetadataAfterAttributeSchemaChange(
  context: ReqContext,
  attributeSchema: SDKAttributeSchema,
  delayMs = EVENT_FORWARDER_WAREHOUSE_SYNC_DELAY_MS,
): Promise<void> {
  const configs = await context.models.eventForwarderConfigs.getAll();
  const configsByDatasourceId = new Map(
    configs.map((config) => [config.datasourceId, config]),
  );
  const runAt = new Date(Date.now() + delayMs);

  for (const [datasourceId, eventForwarderConfig] of configsByDatasourceId) {
    const datasource = await getDataSourceById(context, datasourceId);
    if (!datasource) {
      continue;
    }

    const factTable = await getEventForwarderEventsFactTableForDatasource(
      context,
      datasource,
    );
    if (!factTable) {
      continue;
    }

    const userIdTypes =
      datasource.settings?.userIdTypes?.map((u) => u.userIdType) ?? [];
    const desiredColumns = buildEventForwarderEventsFactTableColumns(
      userIdTypes,
      attributeSchema,
      datasource.projects,
    );
    const desiredSql = buildEventForwarderEventsFactTableSqlForDatasource(
      context,
      eventForwarderConfig,
      datasource,
      attributeSchema,
    );
    const comparableExistingColumns = (factTable.columns ?? []).map(
      (column) => ({
        column: column.column,
        name: column.name,
        description: column.description,
        numberFormat: column.numberFormat,
        datatype: column.datatype,
        jsonFields: column.jsonFields,
      }),
    );
    const comparableDesiredColumns = desiredColumns.map((column) => ({
      column: column.column,
      name: column.name ?? "",
      description: column.description ?? "",
      numberFormat: column.numberFormat ?? "",
      datatype: column.datatype,
      jsonFields: column.jsonFields,
    }));
    const hasMetadataChanges =
      JSON.stringify(comparableExistingColumns) !==
        JSON.stringify(comparableDesiredColumns) ||
      (desiredSql !== null && factTable.sql !== desiredSql);
    const shouldMarkColumnRefreshPending =
      factTable.columnRefreshPending !== true;

    if (hasMetadataChanges || shouldMarkColumnRefreshPending) {
      const now = new Date();
      const columns: ColumnInterface[] = desiredColumns.map((column) => {
        const existing = factTable.columns?.find(
          (existingColumn) => existingColumn.column === column.column,
        );
        return mergeEventForwarderFactTableColumnFromDesired(
          column,
          existing,
          now,
        );
      });
      await updateFactTable(
        getContextForAgendaJobByOrgObject(context.org),
        factTable,
        {
          ...(hasMetadataChanges && {
            columns,
            ...(desiredSql !== null && { sql: desiredSql }),
          }),
          ...(shouldMarkColumnRefreshPending && {
            columnRefreshPending: true,
          }),
        },
      );
    }

    await queueFactTableColumnsRefreshAt(factTable, runAt);
  }
}

export function mergeEventForwarderFactTableColumnFromDesired(
  desired: CreateColumnProps,
  existing: ColumnInterface | undefined,
  now: Date,
): ColumnInterface {
  return {
    column: desired.column,
    name: desired.name ?? existing?.name ?? "",
    description: desired.description ?? existing?.description ?? "",
    numberFormat: desired.numberFormat ?? existing?.numberFormat ?? "",
    datatype: desired.datatype,
    jsonFields: desired.jsonFields,
    dateCreated: existing?.dateCreated ?? now,
    dateUpdated: now,
    deleted: false,
    topValues: existing?.topValues ?? [],
    autoSlices: existing?.autoSlices ?? [],
    lockedAutoSlices: existing?.lockedAutoSlices ?? [],
    ...(existing?.alwaysInlineFilter !== undefined && {
      alwaysInlineFilter: existing.alwaysInlineFilter,
    }),
    ...(existing?.isAutoSliceColumn !== undefined && {
      isAutoSliceColumn: existing.isAutoSliceColumn,
    }),
    ...(existing?.topValuesDate !== undefined && {
      topValuesDate: existing.topValuesDate,
    }),
  };
}

export async function ensureEventForwarderEventsFactTable(
  context: ReqContext,
  eventForwarderConfig: EventForwarderConfigInterface,
  datasourceParams?: BigQueryConnectionParams | SnowflakeConnectionParams,
): Promise<string | undefined> {
  const datasource = await getDataSourceById(
    context,
    eventForwarderConfig.datasourceId,
  );
  if (!datasource) {
    return undefined;
  }

  const existing = await getEventForwarderEventsFactTableForDatasource(
    context,
    datasource,
  );
  if (existing) {
    return existing.id;
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
    return undefined;
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
        return undefined;
      }

      const decrypted =
        decryptEventForwarderConfigModel<BigQueryEventForwarderStoredConfig>(
          eventForwarderConfig,
        );

      sql = buildEventForwarderEventsFactTableSql({
        sinkType: "bigquery",
        projectId,
        dataset: decrypted.dataset.trim(),
        tablePrefix: getBigQueryEventForwarderTablePrefix(decrypted),
        attributeSchema: context.org.settings?.attributeSchema,
        datasourceProjects: datasource.projects,
        userIdTypes,
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
        tablePrefix: getSnowflakeEventForwarderTablePrefix(decrypted),
        attributeSchema: context.org.settings?.attributeSchema,
        datasourceProjects: datasource.projects,
        userIdTypes,
      });
      break;
    }
    default:
      throw new Error(
        `Unsupported event forwarder sink type for Events fact table: ${String(eventForwarderConfig.sinkType)}`,
      );
  }

  const columns = buildEventForwarderEventsFactTableColumns(
    userIdTypes,
    context.org.settings?.attributeSchema,
    datasource.projects,
  );

  const factTable = await createFactTable(context, {
    id: getEventForwarderEventsFactTableId(datasource.id),
    name: getEventForwarderEventsFactTableName(datasource.name),
    description:
      "This fact table was auto-generated when the event forwarder was enabled and is read-only. As you make changes to attributes, we'll automatically update the Fact Table's SQL to reflect the changes. If you&apos;d like to customize this Fact Table, you can duplicate it and edit the copy.",
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
  return factTable.id;
}

export async function deleteEventForwarderEventsFactTableForDatasource(
  context: ReqContext,
  datasource: DataSourceInterface,
): Promise<void> {
  const sinkType = getEventForwarderSinkTypeForDatasource(datasource);
  if (sinkType !== "bigquery" && sinkType !== "snowflake") {
    return;
  }

  const factTable = await getEventForwarderEventsFactTableForDatasource(
    context,
    datasource,
  );

  if (!factTable) {
    return;
  }

  await deleteFactTable(context, factTable, { bypassManagedByCheck: true });
}
