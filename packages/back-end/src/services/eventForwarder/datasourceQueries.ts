import { BigQueryConnectionParams } from "shared/types/integrations/bigquery";
import { SnowflakeConnectionParams } from "shared/types/integrations/snowflake";
import { EventForwarderConfigInterface } from "shared/validators";
import {
  buildEventForwarderFeatureUsageQuery,
  isEventForwarderManagedFeatureUsageQuery,
} from "shared/util";
import uniqid from "uniqid";
import {
  getDataSourceById,
  updateDataSource,
} from "back-end/src/models/DataSourceModel";
import { buildFeatureUsageQueryParams } from "back-end/src/services/eventForwarder/sinkParams";
import { getSourceIntegrationObject } from "back-end/src/services/datasource";
import { logger } from "back-end/src/util/logger";
import { ReqContext } from "back-end/types/request";

export async function ensureEventForwarderFeatureUsageQuery(
  context: ReqContext,
  eventForwarderConfig: EventForwarderConfigInterface,
  datasourceParams?: BigQueryConnectionParams | SnowflakeConnectionParams,
): Promise<string[]> {
  const datasource = await getDataSourceById(
    context,
    eventForwarderConfig.datasourceId,
  );
  if (!datasource) {
    return [];
  }

  const existing = datasource.settings?.queries?.featureUsage ?? [];
  const existingManaged = existing.filter(
    isEventForwarderManagedFeatureUsageQuery,
  );
  if (existingManaged.length > 0) {
    return existingManaged.map((query) => query.id);
  }

  const connectionParams =
    datasourceParams ??
    (getSourceIntegrationObject(context, datasource).params as
      | BigQueryConnectionParams
      | SnowflakeConnectionParams);

  const sqlParams = buildFeatureUsageQueryParams(
    eventForwarderConfig,
    connectionParams,
  );
  if (!sqlParams) {
    logger.warn(
      {
        datasourceId: datasource.id,
        organizationId: context.org.id,
        sinkType: eventForwarderConfig.sinkType,
      },
      "Skipping event forwarder feature usage query: missing sink connection params",
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
        ...datasource.settings,
        queries: {
          ...datasource.settings?.queries,
          featureUsage: [...existing, managedQuery],
        },
      },
    },
    { skipEventForwarderManagedValidation: true },
  );
  return [managedQuery.id];
}
