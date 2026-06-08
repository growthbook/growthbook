import {
  buildUserIdTypesFromAttributeSchema,
  mergeUserIdTypes,
  refreshEventForwarderManagedExposureQuery,
} from "shared/util";
import { SDKAttribute, SDKAttributeSchema } from "shared/types/organization";
import { UserIdType } from "shared/types/datasource";
import { EventForwarderConfigInterface } from "shared/validators";
import { BigQueryConnectionParams } from "shared/types/integrations/bigquery";
import { SnowflakeConnectionParams } from "shared/types/integrations/snowflake";
import {
  getDataSourceById,
  getRawDataSourceById,
  updateDataSource,
} from "back-end/src/models/DataSourceModel";
import {
  buildExposureQueryParams,
  ensureEventForwarderExposureQueries,
} from "back-end/src/services/eventForwarderExposureQueries";
import { getSourceIntegrationObject } from "back-end/src/services/datasource";
import { logger } from "back-end/src/util/logger";
import { ReqContext } from "back-end/types/request";

function renameUserIdTypeInPlace(
  userIdTypes: UserIdType[],
  previousName: string,
  newName: string,
): UserIdType[] {
  const normalizedPrevious = previousName.toLowerCase();
  let changed = false;

  const updated = userIdTypes.map((userIdType) => {
    if (userIdType.userIdType.toLowerCase() !== normalizedPrevious) {
      return userIdType;
    }

    changed = true;
    return {
      ...userIdType,
      userIdType: newName,
      attributes: [newName],
    };
  });

  return changed ? updated : userIdTypes;
}

async function ensureExposureQueriesAfterUserIdTypesSync(
  context: ReqContext,
  eventForwarderConfig: EventForwarderConfigInterface,
  syncedUserIdTypes: string[],
  attributeSchema: SDKAttributeSchema,
): Promise<void> {
  try {
    await ensureEventForwarderExposureQueries(
      context,
      eventForwarderConfig,
      syncedUserIdTypes,
      undefined,
      attributeSchema,
      { queueWarehouseSync: false },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logger.error(
      {
        datasourceId: eventForwarderConfig.datasourceId,
        organizationId: context.org.id,
        error: message,
      },
      "Failed to create exposure queries after event forwarder userIdTypes sync",
    );
  }
}

export async function initializeDatasourceUserIdTypesFromOrgAttributeSchema(
  context: ReqContext,
  datasourceId: string,
  eventForwarderConfig?: EventForwarderConfigInterface,
): Promise<void> {
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
  const syncedUserIdTypes = built.map((userIdType) => userIdType.userIdType);

  if (merged.length === existing.length) {
    if (eventForwarderConfig) {
      await ensureExposureQueriesAfterUserIdTypesSync(
        context,
        eventForwarderConfig,
        syncedUserIdTypes,
        context.org.settings?.attributeSchema ?? [],
      );
    }
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

  if (eventForwarderConfig) {
    await ensureExposureQueriesAfterUserIdTypesSync(
      context,
      eventForwarderConfig,
      syncedUserIdTypes,
      context.org.settings?.attributeSchema ?? [],
    );
  }
}

export async function syncAllEventForwarderDatasourceUserIdTypesFromAttributeSchema(
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
        const raw = await getRawDataSourceById(context, config.datasourceId);
        if (!raw) {
          return;
        }

        const built = buildUserIdTypesFromAttributeSchema(
          attributeSchema,
          raw.projects,
        );
        const existing = raw.settings?.userIdTypes ?? [];
        const merged = mergeUserIdTypes(existing, built);
        const syncedUserIdTypes = built.map(
          (userIdType) => userIdType.userIdType,
        );

        if (merged.length !== existing.length) {
          const datasource = await getDataSourceById(
            context,
            config.datasourceId,
          );
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

        await ensureExposureQueriesAfterUserIdTypesSync(
          context,
          config,
          syncedUserIdTypes,
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

export async function syncHashAttributeMetadataForEventForwarder(
  context: ReqContext,
  {
    before,
    after,
    previousName,
  }: {
    before: SDKAttribute;
    after: SDKAttribute;
    previousName?: string;
    attributeSchema: SDKAttributeSchema;
  },
): Promise<void> {
  const configs = await context.models.eventForwarderConfigs.getAll();
  if (configs.length === 0) {
    return;
  }

  const oldName = previousName ?? before.property;
  const renamed = oldName !== after.property;
  const datatypeChanged = before.datatype !== after.datatype;

  if (!renamed && !datatypeChanged) {
    return;
  }

  await Promise.all(
    configs.map(async (config) => {
      try {
        const raw = await getRawDataSourceById(context, config.datasourceId);
        if (!raw) {
          return;
        }

        const datasource = await getDataSourceById(
          context,
          config.datasourceId,
        );
        const connectionParams = datasource
          ? (getSourceIntegrationObject(context, datasource).params as
              | BigQueryConnectionParams
              | SnowflakeConnectionParams)
          : undefined;
        const sqlParams = buildExposureQueryParams(config, connectionParams);
        if (!sqlParams) {
          logger.warn(
            {
              datasourceId: config.datasourceId,
              organizationId: context.org.id,
              sinkType: config.sinkType,
            },
            "Skipping hash attribute metadata sync: missing sink connection params",
          );
          return;
        }

        const existingUserIdTypes = raw.settings?.userIdTypes ?? [];
        const updatedUserIdTypes = renamed
          ? renameUserIdTypeInPlace(
              existingUserIdTypes,
              oldName,
              after.property,
            )
          : existingUserIdTypes;

        const existingExposure = raw.settings?.queries?.exposure ?? [];
        const updatedExposure = refreshEventForwarderManagedExposureQuery(
          existingExposure,
          oldName,
          after,
          sqlParams,
        );

        const userIdTypesChanged =
          JSON.stringify(updatedUserIdTypes) !==
          JSON.stringify(existingUserIdTypes);
        const exposureChanged =
          JSON.stringify(updatedExposure) !== JSON.stringify(existingExposure);

        if (!userIdTypesChanged && !exposureChanged) {
          return;
        }

        if (!datasource) {
          logger.warn(
            {
              datasourceId: config.datasourceId,
              organizationId: context.org.id,
            },
            "Skipping hash attribute metadata sync: datasource unavailable",
          );
          return;
        }

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
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown error";
        logger.error(
          {
            datasourceId: config.datasourceId,
            organizationId: context.org.id,
            error: message,
          },
          "Failed to sync hash attribute metadata for event forwarder datasource",
        );
      }
    }),
  );
}
