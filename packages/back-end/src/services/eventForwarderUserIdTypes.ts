import {
  buildUserIdTypesFromAttributeSchema,
  mergeUserIdTypes,
  isEventForwarderManagedExposureQuery,
  reconcileEventForwarderManagedExposureQueries,
} from "shared/util";
import { SDKAttributeSchema } from "shared/types/organization";
import { ExposureQuery, UserIdType } from "shared/types/datasource";
import { EventForwarderConfigInterface } from "shared/validators";
import { BigQueryConnectionParams } from "shared/types/integrations/bigquery";
import { SnowflakeConnectionParams } from "shared/types/integrations/snowflake";
import {
  getDataSourceById,
  getRawDataSourceById,
  updateDataSource,
} from "back-end/src/models/DataSourceModel";
import { buildExposureQueryParams } from "back-end/src/services/eventForwarderExposureQueries";
import { getSourceIntegrationObject } from "back-end/src/services/datasource";
import { logger } from "back-end/src/util/logger";
import { ReqContext } from "back-end/types/request";

function normalize(value: string): string {
  return value.toLowerCase();
}

function reconcileUserIdTypes(
  existing: UserIdType[],
  desired: UserIdType[],
  ownedUserIdTypes: string[],
): UserIdType[] {
  const desiredIds = new Set(desired.map((item) => normalize(item.userIdType)));
  const ownedIds = new Set(ownedUserIdTypes.map(normalize));
  const preserved = existing.filter((item) => {
    const id = normalize(item.userIdType);
    return !desiredIds.has(id) && !ownedIds.has(id);
  });

  return [...preserved, ...desired];
}

function getManagedExposureOwnership(exposureQueries: ExposureQuery[]): {
  userIdTypes: string[];
} {
  const managed = (exposureQueries ?? []).filter(
    isEventForwarderManagedExposureQuery,
  );

  return {
    userIdTypes: managed.map((query) => query.userIdType),
  };
}

function hasChanges<T>(before: T, after: T): boolean {
  return JSON.stringify(before) !== JSON.stringify(after);
}

export async function initializeDatasourceUserIdTypesFromOrgAttributeSchema(
  context: ReqContext,
  datasourceId: string,
  eventForwarderConfig?: EventForwarderConfigInterface,
): Promise<void> {
  if (eventForwarderConfig) {
    await reconcileEventForwarderDatasourceUserIdTypesAndExposureQueries(
      context,
      eventForwarderConfig,
      context.org.settings?.attributeSchema ?? [],
    );
    return;
  }

  const raw = await getRawDataSourceById(context, datasourceId);
  if (!raw) {
    return;
  }

  const built = buildUserIdTypesFromAttributeSchema(
    context.org.settings?.attributeSchema ?? [],
    raw.projects,
  );

  const existing = raw.settings?.userIdTypes ?? [];
  const merged = mergeUserIdTypes(existing, built);

  if (merged.length === existing.length) {
    return;
  }

  const datasource = await getDataSourceById(context, datasourceId);
  if (!datasource) {
    return;
  }

  await updateDataSource(context, datasource, {
    settings: {
      ...raw.settings,
      userIdTypes: merged,
    },
  });
}

export async function reconcileEventForwarderDatasourceUserIdTypesAndExposureQueries(
  context: ReqContext,
  config: EventForwarderConfigInterface,
  attributeSchema: SDKAttributeSchema,
): Promise<void> {
  const raw = await getRawDataSourceById(context, config.datasourceId);
  if (!raw) {
    return;
  }

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

  const desiredUserIdTypes = buildUserIdTypesFromAttributeSchema(
    attributeSchema,
    raw.projects,
  );
  const desiredUserIdTypeIds = desiredUserIdTypes.map(
    (userIdType) => userIdType.userIdType,
  );
  const existingUserIdTypes = raw.settings?.userIdTypes ?? [];
  const existingExposure = raw.settings?.queries?.exposure ?? [];
  const managedExposure = getManagedExposureOwnership(existingExposure);
  const ownedUserIdTypes = [
    ...desiredUserIdTypeIds,
    ...managedExposure.userIdTypes,
  ];
  const updatedUserIdTypes = reconcileUserIdTypes(
    existingUserIdTypes,
    desiredUserIdTypes,
    ownedUserIdTypes,
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
      userIdTypes: desiredUserIdTypeIds,
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
          ...raw.settings,
          userIdTypes: updatedUserIdTypes,
          queries: {
            ...raw.settings?.queries,
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

export async function syncAllEventForwarderDatasourceUserIdTypesFromAttributeSchema(
  context: ReqContext,
  attributeSchema: SDKAttributeSchema,
): Promise<void> {
  await reconcileAllEventForwarderDatasourceUserIdTypesAndExposureQueries(
    context,
    attributeSchema,
  );
}
