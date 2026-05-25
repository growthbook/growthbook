import { isEventForwarderManagedExposureQuery } from "shared/util";
import { ReqContext } from "back-end/types/request";
import {
  getDataSourceById,
  getRawDataSourceById,
  updateDataSource,
  validateExposureQueriesAndAddMissingIds,
} from "back-end/src/models/DataSourceModel";
import { getEventForwarderEventsFactTableForDatasource } from "back-end/src/services/eventForwarderFactTable";
import { queueFactTableColumnsRefresh } from "back-end/src/jobs/refreshFactTableColumns";
import { logger } from "back-end/src/util/logger";

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

export async function runEventForwarderWarehouseRefreshes(
  context: ReqContext,
  datasourceId: string,
): Promise<void> {
  const datasource = await getDataSourceById(context, datasourceId);
  if (!datasource) {
    return;
  }

  const factTable = await getEventForwarderEventsFactTableForDatasource(
    context,
    datasource,
  );
  if (factTable) {
    try {
      await queueFactTableColumnsRefresh(factTable);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      logger.error(
        {
          datasourceId,
          organizationId: context.org.id,
          error: message,
        },
        "Failed to queue fact table columns refresh after event forwarder warehouse sync",
      );
    }
  }

  try {
    await revalidateManagedEventForwarderDataSourceQueries(
      context,
      datasourceId,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logger.error(
      {
        datasourceId,
        organizationId: context.org.id,
        error: message,
      },
      "Failed to revalidate event forwarder datasource queries after warehouse sync",
    );
  }
}
