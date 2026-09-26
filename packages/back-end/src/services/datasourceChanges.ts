import { getEventForwarderDatasourceParams } from "shared/util";
import {
  DataSourceInterface,
  DataSourceParams,
  DataSourceSettings,
  DataSourceType,
} from "shared/types/datasource";
import { GoogleAnalyticsParams } from "shared/types/integrations/googleanalytics";
import { EventForwarderConfigDraft } from "shared/types/event-forwarder";
import { QueryInterface } from "shared/types/query";
import {
  deleteDatasource,
  updateDataSource,
} from "back-end/src/models/DataSourceModel";
import { getMetricsByDatasource } from "back-end/src/models/MetricModel";
import { findDimensionsByDataSource } from "back-end/src/models/DimensionModel";
import { deleteInformationSchemaById } from "back-end/src/models/InformationSchemaModel";
import { deleteInformationSchemaTablesByInformationSchemaId } from "back-end/src/models/InformationSchemaTablesModel";
import { updateQueryIfRunning } from "back-end/src/models/QueryModel";
import { getOauth2Client } from "back-end/src/integrations/GoogleAnalytics";
import {
  encryptParams,
  getIntegrationFromDatasourceId,
  getSourceIntegrationObject,
  mergeParams,
} from "back-end/src/services/datasource";
import { syncEventForwarderAfterDatasourceUpdate } from "back-end/src/services/eventForwarder/datasourceLifecycle";
import { cancelQueryAndConfirm } from "back-end/src/services/queryCancellation";
import { QUERY_CANCELLED_BY_USER_ERROR } from "back-end/src/queryRunners/QueryRunner";
import { BadRequestError } from "back-end/src/util/errors";
import { logger } from "back-end/src/util/logger";
import { ReqContext } from "back-end/types/request";
import { ApiReqContext } from "back-end/types/api";

type Context = ReqContext | ApiReqContext;

/** Refuses while anything still depends on the data source. */
export async function deleteDataSourceWithChecks(
  context: Context,
  datasource: DataSourceInterface,
) {
  if (!context.permissions.canDeleteDataSource(datasource)) {
    context.permissions.throwPermissionError();
  }
  if (context.org.settings?.defaultDataSource === datasource.id) {
    throw new BadRequestError(
      "Error: This is the default data source for your organization. You must select a new default data source in your Organization Settings before deleting this one.",
    );
  }
  if ((await getMetricsByDatasource(context, datasource.id)).length > 0) {
    throw new BadRequestError(
      "Error: Please delete all metrics tied to this datasource first.",
    );
  }
  if ((await context.models.segments.getByDataSource(datasource.id)).length) {
    throw new BadRequestError(
      "Error: Please delete all segments tied to this datasource first.",
    );
  }
  const dimensions = await findDimensionsByDataSource(
    datasource.id,
    datasource.organization,
  );
  if (dimensions.length > 0) {
    throw new BadRequestError(
      "Error: Please delete all dimensions tied to this datasource first.",
    );
  }

  await deleteDatasource(context, datasource);

  const informationSchemaId = datasource.settings?.informationSchemaId;
  if (informationSchemaId) {
    await deleteInformationSchemaById(context.org.id, informationSchemaId);
    await deleteInformationSchemaTablesByInformationSchemaId(
      context.org.id,
      informationSchemaId,
    );
  }
}

export type DataSourceChanges = {
  name?: string;
  description?: string;
  type?: DataSourceType;
  params?: Partial<DataSourceParams>;
  settings?: DataSourceSettings;
  projects?: string[];
  eventForwarderConfig?: EventForwarderConfigDraft | null;
};

/**
 * Connection params need more permission than query settings, and are
 * re-tested before they're saved.
 */
export async function updateDataSourceWithChecks(
  context: Context,
  datasource: DataSourceInterface,
  changes: DataSourceChanges,
) {
  const { name, type, params, settings, projects, eventForwarderConfig } =
    changes;

  if (!context.permissions.canUpdateDataSourceSettings(datasource)) {
    context.permissions.throwPermissionError();
  }
  if (params && !context.permissions.canUpdateDataSourceParams(datasource)) {
    context.permissions.throwPermissionError();
  }
  // Moving it needs access to the new projects too
  if (
    projects &&
    !context.permissions.canUpdateDataSourceSettings({ projects })
  ) {
    context.permissions.throwPermissionError();
  }
  if (type && type !== datasource.type) {
    throw new BadRequestError(
      "Cannot change the type of an existing data source. Create a new one instead.",
    );
  }
  if (eventForwarderConfig === null) {
    throw new BadRequestError(
      "Cannot remove an Event Forwarder via datasource update. Use DELETE /datasource/:id/event-forwarder instead.",
    );
  }

  const updates: Partial<DataSourceInterface> = { dateUpdated: new Date() };
  if (name) updates.name = name;
  if ("description" in changes) updates.description = changes.description;
  if (settings) updates.settings = settings;
  if (projects) updates.projects = projects;

  if (
    type === "google_analytics" &&
    params &&
    (params as GoogleAnalyticsParams).refreshToken
  ) {
    const { tokens } = await getOauth2Client().getToken(
      (params as GoogleAnalyticsParams).refreshToken,
    );
    (params as GoogleAnalyticsParams).refreshToken = tokens.refresh_token || "";
  }

  // Only a connection change needs re-validating
  if (params) {
    const integration = getSourceIntegrationObject(context, datasource);
    mergeParams(integration, params);
    await integration.testConnection();
    updates.params = encryptParams(integration.params);
  }

  await updateDataSource(context, datasource, updates);

  const updated = { ...datasource, ...updates };
  const integration = getSourceIntegrationObject(context, updated);

  // The update is committed; a failed Event Forwarder sync records its own
  // error status, so report it as a warning rather than a failed update.
  let eventForwarderWarning: string | undefined;
  try {
    await syncEventForwarderAfterDatasourceUpdate({
      context,
      datasource: updated,
      eventForwarderConfig,
      datasourceParams: getEventForwarderDatasourceParams(
        updated.type,
        integration.params,
      ),
      didUpdateDatasourceParams: !!params,
    });
  } catch (e) {
    logger.error(e, "Data source updated, but Event Forwarder sync failed");
    eventForwarderWarning =
      e.message || "Event Forwarder sync failed. Please try again.";
  }

  return { updated, integration, eventForwarderWarning };
}

export async function cancelRunningQuery(
  context: Context,
  query: QueryInterface,
  cancelledBy: string,
) {
  if (query.status !== "running") {
    throw new BadRequestError("Only running queries can be cancelled");
  }
  const integration = await getIntegrationFromDatasourceId(
    context,
    query.datasource,
    true,
  );
  if (query.externalId) {
    await cancelQueryAndConfirm(
      integration,
      { externalId: query.externalId, metadata: query.externalIdMetadata },
      { datasourceId: query.datasource, queryId: query.id },
    );
  }
  const updated = await updateQueryIfRunning(context, query, {
    status: "failed",
    finishedAt: new Date(),
    error: `${QUERY_CANCELLED_BY_USER_ERROR} (${cancelledBy})`,
  });
  if (!updated) {
    throw new BadRequestError(
      "Query is no longer in running state and cannot be cancelled",
    );
  }
}
