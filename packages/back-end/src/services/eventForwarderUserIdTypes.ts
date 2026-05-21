import {
  buildUserIdTypesFromAttributeSchema,
  mergeUserIdTypes,
} from "shared/util";
import { SDKAttributeSchema } from "shared/types/organization";
import {
  getDataSourceById,
  getRawDataSourceById,
  updateDataSource,
} from "back-end/src/models/DataSourceModel";
import { logger } from "back-end/src/util/logger";
import { ReqContext } from "back-end/types/request";

export async function initializeDatasourceUserIdTypesFromOrgAttributeSchema(
  context: ReqContext,
  datasourceId: string,
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
