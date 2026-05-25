import {
  BigQueryEventForwarderStoredConfig,
  SnowflakeEventForwarderStoredConfig,
} from "shared/types/event-forwarder";
import { BigQueryConnectionParams } from "shared/types/integrations/bigquery";
import { SnowflakeConnectionParams } from "shared/types/integrations/snowflake";
import {
  buildBigQueryEventForwarderTableReference,
  buildEventForwarderColumnProbeSql,
  buildSnowflakeEventForwarderTableReference,
  EventForwarderWarehouseSyncExpectation,
  isEventForwarderManagedExposureQuery,
  normalizeSnowflakeTableNameForEventForwarder,
} from "shared/util";
import { EventForwarderConfigInterface } from "shared/validators";
import { ReqContext } from "back-end/types/request";
import {
  getDataSourceById,
  getRawDataSourceById,
} from "back-end/src/models/DataSourceModel";
import {
  getSourceIntegrationObject,
  testFeatureUsageQueryValidity,
  testQueryValidity,
} from "back-end/src/services/datasource";
import { testEventForwarderWarehouseColumnProbeValidity } from "back-end/src/services/eventForwarderWarehouseColumnValidity";
import {
  decryptEventForwarderConfigModel,
  getEventForwarderConfigForDatasource,
} from "back-end/src/services/eventForwarderConfig";

type CatchAllTableProbeParams = {
  sinkType: "bigquery" | "snowflake";
  tableRef: string;
  partitionFilter: boolean;
};

function buildCatchAllTableProbeParams(
  eventForwarderConfig: EventForwarderConfigInterface,
  connectionParams?: BigQueryConnectionParams | SnowflakeConnectionParams,
): CatchAllTableProbeParams | null {
  switch (eventForwarderConfig.sinkType) {
    case "bigquery": {
      const bigqueryParams = connectionParams as
        | BigQueryConnectionParams
        | undefined;
      const projectId =
        bigqueryParams?.defaultProject?.trim() ||
        bigqueryParams?.projectId?.trim() ||
        "";
      if (!projectId) {
        return null;
      }

      const decrypted =
        decryptEventForwarderConfigModel<BigQueryEventForwarderStoredConfig>(
          eventForwarderConfig,
        );

      return {
        sinkType: "bigquery",
        tableRef: buildBigQueryEventForwarderTableReference(
          projectId,
          decrypted.dataset.trim(),
          decrypted.tableName.trim(),
        ),
        partitionFilter: true,
      };
    }
    case "snowflake": {
      const decrypted =
        decryptEventForwarderConfigModel<SnowflakeEventForwarderStoredConfig>(
          eventForwarderConfig,
        );

      return {
        sinkType: "snowflake",
        tableRef: buildSnowflakeEventForwarderTableReference(
          decrypted.database.trim(),
          decrypted.schema.trim(),
          normalizeSnowflakeTableNameForEventForwarder(
            decrypted.tableName.trim(),
          ),
        ),
        partitionFilter: false,
      };
    }
    default:
      return null;
  }
}

async function checkEventForwarderCatchAllTableColumnsReady(
  context: ReqContext,
  datasourceId: string,
  columnNames: string[],
  tableLabel: string,
): Promise<string | undefined> {
  if (columnNames.length === 0) {
    return undefined;
  }

  const datasource = await getDataSourceById(context, datasourceId);
  if (!datasource) {
    return "Datasource not found";
  }

  const eventForwarderConfig = await getEventForwarderConfigForDatasource(
    context,
    datasourceId,
  );
  if (!eventForwarderConfig) {
    return "Event forwarder config not found";
  }

  const integration = getSourceIntegrationObject(context, datasource);
  const connectionParams = integration.params as
    | BigQueryConnectionParams
    | SnowflakeConnectionParams;

  const probeParams = buildCatchAllTableProbeParams(
    eventForwarderConfig,
    connectionParams,
  );
  if (!probeParams) {
    return "Unable to build event forwarder catch-all table probe";
  }

  const probeSql = buildEventForwarderColumnProbeSql({
    sinkType: probeParams.sinkType,
    tableRef: probeParams.tableRef,
    columnNames,
    partitionFilter: probeParams.partitionFilter,
  });

  const error = await testEventForwarderWarehouseColumnProbeValidity(
    integration,
    probeSql,
    columnNames,
    context.org.settings?.testQueryDays,
    "timestamp",
  );

  if (error) {
    return `${tableLabel}: ${error}`;
  }

  return undefined;
}

export async function checkEventForwarderWarehouseReady(
  context: ReqContext,
  datasourceId: string,
  expectation: EventForwarderWarehouseSyncExpectation,
): Promise<{ ready: boolean; reasons: string[] }> {
  const reasons: string[] = [];

  const raw = await getRawDataSourceById(context, datasourceId);
  const datasource = await getDataSourceById(context, datasourceId);
  if (!raw || !datasource) {
    return { ready: false, reasons: ["Datasource not found"] };
  }

  const integration = getSourceIntegrationObject(context, datasource);
  const testDays = context.org.settings?.testQueryDays;

  const exposure = raw.settings?.queries?.exposure ?? [];
  const managedExposure = exposure.filter(isEventForwarderManagedExposureQuery);

  if (expectation.kind === "initial") {
    for (const query of managedExposure) {
      const error = await testQueryValidity(integration, query, testDays);
      if (error) {
        reasons.push(`experiment_viewed (${query.userIdType}): ${error}`);
      }
    }

    const featureUsage = raw.settings?.queries?.featureUsage ?? [];
    for (const query of featureUsage) {
      if (query.managedBy !== "api") {
        continue;
      }
      const error = await testFeatureUsageQueryValidity(
        integration,
        query,
        testDays,
      );
      if (error) {
        reasons.push(`feature_usage: ${error}`);
      }
    }

    const userIdTypes =
      datasource.settings?.userIdTypes?.map((u) => u.userIdType) ?? [];
    const eventsError = await checkEventForwarderCatchAllTableColumnsReady(
      context,
      datasourceId,
      userIdTypes,
      "events",
    );
    if (eventsError) {
      reasons.push(eventsError);
    }
  } else {
    const eventsError = await checkEventForwarderCatchAllTableColumnsReady(
      context,
      datasourceId,
      expectation.columnNames,
      "events",
    );
    if (eventsError) {
      reasons.push(eventsError);
    }
  }

  return { ready: reasons.length === 0, reasons };
}
