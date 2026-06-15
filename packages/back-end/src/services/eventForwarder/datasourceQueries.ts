import { BigQueryConnectionParams } from "shared/types/integrations/bigquery";
import { SnowflakeConnectionParams } from "shared/types/integrations/snowflake";
import { SDKAttributeSchema } from "shared/types/organization";
import { EventForwarderConfigInterface } from "shared/validators";
import {
  buildEventForwarderFeatureUsageQuery,
  isEventForwarderManagedFeatureUsageQuery,
  isHashAttributeUserIdType,
  mergeEventForwarderExposureQueries,
} from "shared/util";
import uniqid from "uniqid";
import {
  getDataSourceById,
  getRawDataSourceById,
  updateDataSource,
} from "back-end/src/models/DataSourceModel";
import {
  buildExposureQueryParams,
  buildFeatureUsageQueryParams,
} from "back-end/src/services/eventForwarder/sinkParams";
import { queueDelayedEventForwarderWarehouseSyncForDatasource } from "back-end/src/services/eventForwarder/warehouseSync";
import { getSourceIntegrationObject } from "back-end/src/services/datasource";
import { logger } from "back-end/src/util/logger";
import { ReqContext } from "back-end/types/request";

export async function ensureEventForwarderExposureQueries(
  context: ReqContext,
  eventForwarderConfig: EventForwarderConfigInterface,
  userIdTypes: string[],
  datasourceParams?: BigQueryConnectionParams | SnowflakeConnectionParams,
  attributeSchema?: SDKAttributeSchema,
  options?: { queueWarehouseSync?: boolean },
): Promise<void> {
  if (userIdTypes.length === 0) {
    return;
  }

  const raw = await getRawDataSourceById(
    context,
    eventForwarderConfig.datasourceId,
  );
  if (!raw) {
    return;
  }

  const resolvedAttributeSchema =
    attributeSchema ?? context.org.settings?.attributeSchema ?? [];
  const syncedUserIdTypes = userIdTypes.filter((userIdType) =>
    isHashAttributeUserIdType(
      userIdType,
      resolvedAttributeSchema,
      raw.projects,
    ),
  );
  if (syncedUserIdTypes.length === 0) {
    return;
  }

  const datasource = await getDataSourceById(
    context,
    eventForwarderConfig.datasourceId,
  );

  const connectionParams =
    datasourceParams ??
    (datasource
      ? (getSourceIntegrationObject(context, datasource).params as
          | BigQueryConnectionParams
          | SnowflakeConnectionParams)
      : undefined);

  const sqlParams = buildExposureQueryParams(
    eventForwarderConfig,
    connectionParams,
  );
  if (!sqlParams) {
    logger.warn(
      {
        datasourceId: raw.id,
        organizationId: context.org.id,
        sinkType: eventForwarderConfig.sinkType,
      },
      "Skipping event forwarder exposure queries: missing sink connection params",
    );
    return;
  }

  const existing = raw.settings?.queries?.exposure ?? [];
  const merged = mergeEventForwarderExposureQueries(
    existing,
    syncedUserIdTypes,
    sqlParams,
    resolvedAttributeSchema,
  );

  if (merged.length === existing.length) {
    return;
  }

  if (!datasource) {
    logger.warn(
      {
        datasourceId: raw.id,
        organizationId: context.org.id,
        sinkType: eventForwarderConfig.sinkType,
      },
      "Skipping event forwarder exposure queries: datasource unavailable for update",
    );
    return;
  }

  await updateDataSource(
    context,
    datasource,
    {
      settings: {
        ...raw.settings,
        queries: {
          ...raw.settings?.queries,
          exposure: merged,
        },
      },
    },
    { skipEventForwarderManagedValidation: true },
  );

  if (options?.queueWarehouseSync !== false) {
    await queueDelayedEventForwarderWarehouseSyncForDatasource(
      context,
      eventForwarderConfig.datasourceId,
    );
  }
}

export async function ensureEventForwarderFeatureUsageQuery(
  context: ReqContext,
  eventForwarderConfig: EventForwarderConfigInterface,
  datasourceParams?: BigQueryConnectionParams | SnowflakeConnectionParams,
): Promise<string[]> {
  const raw = await getRawDataSourceById(
    context,
    eventForwarderConfig.datasourceId,
  );
  if (!raw) {
    return [];
  }

  const existing = raw.settings?.queries?.featureUsage ?? [];
  const existingManaged = existing.filter(
    isEventForwarderManagedFeatureUsageQuery,
  );
  if (existingManaged.length > 0) {
    return existingManaged.map((query) => query.id);
  }

  const datasource = await getDataSourceById(
    context,
    eventForwarderConfig.datasourceId,
  );

  const connectionParams =
    datasourceParams ??
    (datasource
      ? (getSourceIntegrationObject(context, datasource).params as
          | BigQueryConnectionParams
          | SnowflakeConnectionParams)
      : undefined);

  const sqlParams = buildFeatureUsageQueryParams(
    eventForwarderConfig,
    connectionParams,
  );
  if (!sqlParams) {
    logger.warn(
      {
        datasourceId: raw.id,
        organizationId: context.org.id,
        sinkType: eventForwarderConfig.sinkType,
      },
      "Skipping event forwarder feature usage query: missing sink connection params",
    );
    return [];
  }

  if (!datasource) {
    logger.warn(
      {
        datasourceId: raw.id,
        organizationId: context.org.id,
        sinkType: eventForwarderConfig.sinkType,
      },
      "Skipping event forwarder feature usage query: datasource unavailable for update",
    );
    return [];
  }

  const managedQuery = {
    id: uniqid("fuq_"),
    ...buildEventForwarderFeatureUsageQuery(sqlParams),
  };

  await updateDataSource(
    context,
    datasource,
    {
      settings: {
        ...raw.settings,
        queries: {
          ...raw.settings?.queries,
          featureUsage: [...existing, managedQuery],
        },
      },
    },
    { skipEventForwarderManagedValidation: true },
  );
  return [managedQuery.id];
}
