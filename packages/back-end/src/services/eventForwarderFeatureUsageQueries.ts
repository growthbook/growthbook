import { BigQueryConnectionParams } from "shared/types/integrations/bigquery";
import { SnowflakeConnectionParams } from "shared/types/integrations/snowflake";
import {
  BigQueryEventForwarderStoredConfig,
  SnowflakeEventForwarderStoredConfig,
} from "shared/types/event-forwarder";
import { EventForwarderConfigInterface } from "shared/validators";
import {
  GenerateEventForwarderFeatureUsageQueryParams,
  buildEventForwarderFeatureUsageQuery,
  isEventForwarderManagedFeatureUsageQuery,
} from "shared/util";
import uniqid from "uniqid";
import {
  getDataSourceById,
  getRawDataSourceById,
  updateDataSource,
} from "back-end/src/models/DataSourceModel";
import { decryptEventForwarderConfigModel } from "back-end/src/services/eventForwarderConfig";
import { getSourceIntegrationObject } from "back-end/src/services/datasource";
import { logger } from "back-end/src/util/logger";
import { ReqContext } from "back-end/types/request";

export function buildFeatureUsageQueryParams(
  eventForwarderConfig: EventForwarderConfigInterface,
  connectionParams?: BigQueryConnectionParams | SnowflakeConnectionParams,
): GenerateEventForwarderFeatureUsageQueryParams | null {
  const params = connectionParams;

  switch (eventForwarderConfig.sinkType) {
    case "bigquery": {
      const bigqueryParams = params as BigQueryConnectionParams | undefined;
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
        projectId,
        dataset: decrypted.dataset.trim(),
      };
    }
    case "snowflake": {
      const decrypted =
        decryptEventForwarderConfigModel<SnowflakeEventForwarderStoredConfig>(
          eventForwarderConfig,
        );

      return {
        sinkType: "snowflake",
        database: decrypted.database.trim(),
        schema: decrypted.schema.trim(),
      };
    }
    default:
      return null;
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
