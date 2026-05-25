import { BigQueryConnectionParams } from "shared/types/integrations/bigquery";
import { SnowflakeConnectionParams } from "shared/types/integrations/snowflake";
import {
  BigQueryEventForwarderStoredConfig,
  SnowflakeEventForwarderStoredConfig,
} from "shared/types/event-forwarder";
import { EventForwarderConfigInterface } from "shared/validators";
import {
  GenerateEventForwarderExposureQueriesParams,
  isHashAttributeUserIdType,
  mergeEventForwarderExposureQueries,
} from "shared/util";
import {
  getDataSourceById,
  getRawDataSourceById,
  updateDataSource,
} from "back-end/src/models/DataSourceModel";
import { decryptEventForwarderConfigModel } from "back-end/src/services/eventForwarderConfig";
import { getSourceIntegrationObject } from "back-end/src/services/datasource";
import { logger } from "back-end/src/util/logger";
import { ReqContext } from "back-end/types/request";

function buildExposureQueryParams(
  eventForwarderConfig: EventForwarderConfigInterface,
  connectionParams?: BigQueryConnectionParams | SnowflakeConnectionParams,
): GenerateEventForwarderExposureQueriesParams | null {
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

export async function ensureEventForwarderExposureQueries(
  context: ReqContext,
  eventForwarderConfig: EventForwarderConfigInterface,
  userIdTypes: string[],
  datasourceParams?: BigQueryConnectionParams | SnowflakeConnectionParams,
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

  const attributeSchema = context.org.settings?.attributeSchema ?? [];
  const syncedUserIdTypes = userIdTypes.filter((userIdType) =>
    isHashAttributeUserIdType(userIdType, attributeSchema, raw.projects),
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

  await updateDataSource(context, datasource, {
    settings: {
      ...raw.settings,
      queries: {
        ...raw.settings?.queries,
        exposure: merged,
      },
    },
  });
}
