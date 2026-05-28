import {
  buildUserIdTypesFromAttributeSchema,
  getUserIdTypesToAdd,
  mergeUserIdTypes,
} from "shared/util";
import { SDKAttributeSchema } from "shared/types/organization";
import { EventForwarderConfigInterface } from "shared/validators";
import {
  getDataSourceById,
  getRawDataSourceById,
  updateDataSource,
} from "back-end/src/models/DataSourceModel";
import { ensureEventForwarderExposureQueries } from "back-end/src/services/eventForwarderExposureQueries";
import { logger } from "back-end/src/util/logger";
import { ReqContext } from "back-end/types/request";

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
  const toAdd = getUserIdTypesToAdd(existing, built);
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

  if (eventForwarderConfig) {
    await ensureExposureQueriesAfterUserIdTypesSync(
      context,
      eventForwarderConfig,
      toAdd.map((userIdType) => userIdType.userIdType),
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
        const toAdd = getUserIdTypesToAdd(existing, built);
        const merged = mergeUserIdTypes(existing, built);

        if (merged.length === existing.length) {
          return;
        }

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

        await ensureExposureQueriesAfterUserIdTypesSync(
          context,
          config,
          toAdd.map((userIdType) => userIdType.userIdType),
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
