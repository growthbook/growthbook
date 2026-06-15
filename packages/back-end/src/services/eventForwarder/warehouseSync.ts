import {
  EVENT_FORWARDER_WAREHOUSE_SYNC_DELAY_MS,
  isEventForwarderManagedExposureQuery,
} from "shared/util";
import { ReqContext } from "back-end/types/request";
import {
  getDataSourceById,
  getRawDataSourceById,
  updateDataSource,
  validateExposureQueriesAndAddMissingIds,
} from "back-end/src/models/DataSourceModel";
import { queueDelayedFactTableColumnsRefreshForDatasource } from "back-end/src/services/eventForwarder/factTable";
import { queueRevalidateEventForwarderDataSourceQueriesAt } from "back-end/src/jobs/revalidateEventForwarderDataSourceQueries";
import { logger } from "back-end/src/util/logger";

export { EVENT_FORWARDER_WAREHOUSE_SYNC_DELAY_MS };

export async function revalidateManagedEventForwarderDataSourceQueries(
  context: ReqContext,
  datasourceId: string,
): Promise<void> {
  const raw = await getRawDataSourceById(context, datasourceId);
  if (!raw) {
    return;
  }

  const datasource = await getDataSourceById(context, datasourceId);
  if (!datasource) {
    return;
  }

  const exposure = raw.settings?.queries?.exposure ?? [];
  const featureUsage = raw.settings?.queries?.featureUsage ?? [];
  const hasManagedExposure = exposure.some(
    isEventForwarderManagedExposureQuery,
  );
  const hasManagedFeatureUsage = featureUsage.some(
    (query) => query.managedBy === "api",
  );

  if (!hasManagedExposure && !hasManagedFeatureUsage) {
    return;
  }

  const validated = await validateExposureQueriesAndAddMissingIds(
    context,
    datasource,
    {
      ...raw.settings,
      queries: {
        ...raw.settings?.queries,
        exposure,
        featureUsage,
      },
    },
    true,
  );

  await updateDataSource(context, datasource, {
    settings: validated,
  });
}

export async function queueDelayedEventForwarderWarehouseSyncForDatasource(
  context: ReqContext,
  datasourceId: string,
  delayMs = EVENT_FORWARDER_WAREHOUSE_SYNC_DELAY_MS,
): Promise<void> {
  try {
    await queueDelayedFactTableColumnsRefreshForDatasource(
      context,
      datasourceId,
      delayMs,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logger.error(
      {
        datasourceId,
        organizationId: context.org.id,
        error: message,
      },
      "Failed to queue delayed fact table columns refresh after event forwarder warehouse sync",
    );
  }

  try {
    await queueRevalidateEventForwarderDataSourceQueriesAt(
      context.org.id,
      datasourceId,
      new Date(Date.now() + delayMs),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logger.error(
      {
        datasourceId,
        organizationId: context.org.id,
        error: message,
      },
      "Failed to queue delayed event forwarder query revalidation",
    );
  }
}
