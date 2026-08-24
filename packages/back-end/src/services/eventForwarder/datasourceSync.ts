import {
  getEventForwarderHashAttributes,
  reconcileEventForwarderManagedExposureQueries,
  resolveEventForwarderManagedUserIdTypes,
} from "shared/util";
import { SDKAttributeSchema } from "shared/types/organization";
import { BigQueryConnectionParams } from "shared/types/integrations/bigquery";
import { SnowflakeConnectionParams } from "shared/types/integrations/snowflake";
import { EventForwarderConfigInterface } from "shared/validators";
import isEqual from "lodash/isEqual";
import {
  getDataSourceById,
  updateDataSource,
} from "back-end/src/models/DataSourceModel";
import { buildExposureQueryParams } from "back-end/src/services/eventForwarder/sinkParams";
import { getSourceIntegrationObject } from "back-end/src/services/datasource";
import { logger } from "back-end/src/util/logger";
import { ReqContext } from "back-end/types/request";

function hasChanges<T>(before: T, after: T): boolean {
  return !isEqual(before, after);
}

export async function reconcileEventForwarderDatasourceUserIdTypesAndExposureQueries(
  context: ReqContext,
  config: EventForwarderConfigInterface,
  attributeSchema: SDKAttributeSchema,
): Promise<void> {
  const datasource = await getDataSourceById(context, config.datasourceId);
  if (!datasource) {
    logger.warn(
      {
        datasourceId: config.datasourceId,
        organizationId: context.org.id,
      },
      "Skipping event forwarder datasource reconciliation: datasource unavailable",
    );
    return;
  }

  const existingUserIdTypes = datasource.settings?.userIdTypes ?? [];
  const existingExposure = datasource.settings?.queries?.exposure ?? [];
  const { userIdTypes: updatedUserIdTypes, pairs } =
    resolveEventForwarderManagedUserIdTypes(
      existingUserIdTypes,
      getEventForwarderHashAttributes(attributeSchema, datasource.projects),
    );

  const connectionParams = getSourceIntegrationObject(context, datasource)
    .params as BigQueryConnectionParams | SnowflakeConnectionParams;
  const sqlParams = buildExposureQueryParams(config, connectionParams);
  let updatedExposure = existingExposure;

  if (!sqlParams) {
    logger.warn(
      {
        datasourceId: config.datasourceId,
        organizationId: context.org.id,
        sinkType: config.sinkType,
      },
      "Skipping event forwarder exposure query reconciliation: missing sink connection params",
    );
  } else {
    updatedExposure = reconcileEventForwarderManagedExposureQueries({
      existing: existingExposure,
      pairs,
      params: sqlParams,
      attributeSchema,
    });
  }

  if (
    hasChanges(existingUserIdTypes, updatedUserIdTypes) ||
    hasChanges(existingExposure, updatedExposure)
  ) {
    await updateDataSource(
      context,
      datasource,
      {
        settings: {
          ...datasource.settings,
          userIdTypes: updatedUserIdTypes,
          queries: {
            ...datasource.settings?.queries,
            exposure: updatedExposure,
          },
        },
      },
      { skipEventForwarderManagedValidation: true },
    );
  }
}

export async function reconcileAllEventForwarderDatasourceUserIdTypesAndExposureQueries(
  context: ReqContext,
  attributeSchema: SDKAttributeSchema,
): Promise<void> {
  const configs = await context.models.eventForwarderConfigs.getAll();
  if (configs.length === 0) {
    return;
  }

  await Promise.all(
    configs.map(async (config) => {
      try {
        await reconcileEventForwarderDatasourceUserIdTypesAndExposureQueries(
          context,
          config,
          attributeSchema,
        );
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown error";
        logger.error(
          {
            datasourceId: config.datasourceId,
            organizationId: context.org.id,
            error: message,
          },
          "Failed to sync userIdTypes for event forwarder datasource",
        );
      }
    }),
  );
}
