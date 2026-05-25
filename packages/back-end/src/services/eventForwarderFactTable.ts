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
  getEventForwarderEventsFactTableName,
} from "shared/util";
import type { DataSourceInterface } from "shared/types/datasource";
import {
  createFactTable,
  getFactTable,
  deleteFactTable,
} from "back-end/src/models/FactTableModel";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import {
  decryptEventForwarderConfigModel,
  getEventForwarderSinkTypeForDatasource,
} from "back-end/src/services/eventForwarderConfig";
import { queueFactTableColumnsRefresh } from "back-end/src/jobs/refreshFactTableColumns";
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

  const existing = await getEventForwarderEventsFactTableForDatasource(
    context,
    datasource,
  );
  if (existing) {
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
    id: getEventForwarderEventsFactTableId(datasource.id),
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

  const factTable = await getEventForwarderEventsFactTableForDatasource(
    context,
    datasource,
  );

  if (!factTable) {
    return;
  }

  await deleteFactTable(context, factTable, { bypassManagedByCheck: true });
}
