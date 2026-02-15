import mongoose from "mongoose";
import uniqid from "uniqid";
import lodash from "lodash";
import {
  DataSourceInterface,
  DataSourceParams,
  DataSourceSettings,
  DataSourceType,
} from "shared/types/datasource";
import { GoogleAnalyticsParams } from "shared/types/integrations/googleanalytics";
import { ApiDataSource } from "shared/types/openapi";
import { getOauth2Client } from "back-end/src/integrations/GoogleAnalytics";
import {
  encryptParams,
  getSourceIntegrationObject,
  testDataSourceConnection,
  testQueryValidity,
} from "back-end/src/services/datasource";
import {
  usingFileConfig,
  getConfigDatasources,
} from "back-end/src/init/config";
import { upgradeDatasourceObject } from "back-end/src/util/migrations";
import { queueCreateInformationSchema } from "back-end/src/jobs/createInformationSchema";
import { IS_CLOUD } from "back-end/src/util/secrets";
import { ReqContext } from "back-end/types/request";
import { ApiReqContext } from "back-end/types/api";
import { logger } from "back-end/src/util/logger";
import { deleteClickhouseUser } from "back-end/src/services/clickhouse";
import { createModelAuditLogger } from "back-end/src/services/audit";
import { deleteFactTable, getFactTable } from "./FactTableModel";

const { cloneDeep, isEqual } = lodash;

const audit = createModelAuditLogger({
  entity: "datasource",
  createEvent: "datasource.create",
  updateEvent: "datasource.update",
  deleteEvent: "datasource.delete",
  omitDetails: true,
});

const dataSourceSchema = new mongoose.Schema<DataSourceDocument>({
  id: String,
  name: String,
  description: String,
  organization: {
    type: String,
    index: true,
  },
  dateCreated: Date,
  dateUpdated: Date,
  type: { type: String, index: true },
  params: String,
  projects: {
    type: [String],
    index: true,
  },
  settings: {},
  lockUntil: Date,
});
dataSourceSchema.index({ id: 1, organization: 1 }, { unique: true });
type DataSourceDocument = mongoose.Document & DataSourceInterface;

const DataSourceModel = mongoose.model<DataSourceInterface>(
  "DataSource",
  dataSourceSchema,
);

function toInterface(doc: DataSourceDocument): DataSourceInterface {
  return upgradeDatasourceObject(doc.toJSON());
}

export async function getInstallationDatasources(): Promise<
  DataSourceInterface[]
> {
  if (IS_CLOUD) {
    throw new Error("Cannot get all installation data sources in cloud mode");
  }
  if (usingFileConfig()) {
    // We don't need the correct organization part of the response so passing "".
    return getConfigDatasources("");
  }
  const docs: DataSourceDocument[] = await DataSourceModel.find();
  return docs.map(toInterface);
}

export async function getDataSourcesByOrganization(
  context: ReqContext | ApiReqContext,
): Promise<DataSourceInterface[]> {
  // If using config.yml, immediately return the list from there
  if (usingFileConfig()) {
    return getConfigDatasources(context.org.id);
  }

  const docs: DataSourceDocument[] = await DataSourceModel.find({
    organization: context.org.id,
  });

  const datasources = docs.map(toInterface);

  return datasources.filter((ds) =>
    context.permissions.canReadMultiProjectResource(ds.projects),
  );
}

// WARNING: This does not restrict by organization
export async function _dangerourslyGetAllDatasourcesByOrganizations(
  organizations: string[],
): Promise<DataSourceInterface[]> {
  const docs: DataSourceDocument[] = await DataSourceModel.find({
    organization: { $in: organizations },
  });

  return docs.map(toInterface);
}

// WARNING: This does not restrict by organization
export async function _dangerousGetAllGrowthbookClickhouseDataSources() {
  const docs: DataSourceDocument[] = await DataSourceModel.find({
    type: "growthbook_clickhouse",
  });
  return docs.map(toInterface);
}

export async function getGrowthbookDatasource(context: ReqContext) {
  const orgId = context.org.id;
  const doc: DataSourceDocument | null = await DataSourceModel.findOne({
    type: "growthbook_clickhouse",
    organization: orgId,
  });

  if (!doc) return null;

  const datasource = toInterface(doc);

  return context.permissions.canReadMultiProjectResource(datasource.projects)
    ? datasource
    : null;
}

export async function getDataSourceById(
  context: ReqContext | ApiReqContext,
  id: string,
) {
  // If using config.yml, immediately return the from there
  if (usingFileConfig()) {
    return (
      getConfigDatasources(context.org.id).filter((d) => d.id === id)[0] || null
    );
  }

  const doc: DataSourceDocument | null = await DataSourceModel.findOne({
    id,
    organization: context.org.id,
  });

  if (!doc) return null;

  const datasource = toInterface(doc);

  return context.permissions.canReadMultiProjectResource(datasource.projects)
    ? datasource
    : null;
}

export async function getDataSourcesByIds(
  context: ReqContext | ApiReqContext,
  ids: string[],
) {
  if (usingFileConfig()) {
    return getConfigDatasources(context.org.id).filter((d) =>
      ids.includes(d.id),
    );
  }

  const docs: DataSourceDocument[] = await DataSourceModel.find({
    id: { $in: ids },
    organization: context.org.id,
  });

  return docs
    .map(toInterface)
    .filter((datasource) =>
      context.permissions.canReadMultiProjectResource(datasource.projects),
    );
}

export async function removeProjectFromDatasources(
  project: string,
  organization: string,
) {
  await DataSourceModel.updateMany(
    { organization, projects: project },
    { $pull: { projects: project } },
  );
}

export async function deleteDatasource(
  context: ReqContext | ApiReqContext,
  datasource: DataSourceInterface,
) {
  if (usingFileConfig()) {
    throw new Error("Cannot delete. Data sources managed by config.yml");
  }
  if (datasource.type === "growthbook_clickhouse") {
    await deleteClickhouseUser(context.org.id);

    // Also delete the main events fact table
    try {
      const ft = await getFactTable(context, "ch_events");
      if (ft) {
        await deleteFactTable(context, ft, { bypassManagedByCheck: true });
      }
    } catch (e) {
      logger.error(e, "Error deleting clickhouse events fact table");
    }
  }
  await DataSourceModel.deleteOne({
    id: datasource.id,
    organization: context.org.id,
  });

  await audit.logDelete(context, datasource);
}

/**
 * Deletes data sources where the provided project is the only project of that data source.
 * @param projectId
 * @param organizationId
 */
export async function deleteAllDataSourcesForAProject({
  projectId,
  organizationId,
}: {
  projectId: string;
  organizationId: string;
}) {
  if (usingFileConfig()) {
    throw new Error("Cannot delete. Data sources managed by config.yml");
  }

  await DataSourceModel.deleteMany({
    organization: organizationId,
    projects: [projectId],
  });
}

export async function createDataSource(
  context: ReqContext,
  name: string,
  type: DataSourceType,
  params: DataSourceParams,
  settings: DataSourceSettings,
  id?: string,
  description: string = "",
  projects?: string[],
) {
  if (usingFileConfig()) {
    throw new Error("Cannot add. Data sources managed by config.yml");
  }

  id = id || uniqid("ds_");
  projects = projects || [];

  if (type === "google_analytics") {
    const oauth2Client = getOauth2Client();
    const { tokens } = await oauth2Client.getToken(
      (params as GoogleAnalyticsParams).refreshToken,
    );
    (params as GoogleAnalyticsParams).refreshToken = tokens.refresh_token || "";
  }

  const datasource: DataSourceInterface = {
    id,
    name,
    description,
    organization: context.org.id,
    type,
    settings,
    dateCreated: new Date(),
    dateUpdated: new Date(),
    params: encryptParams(params),
    projects,
  };

  await testDataSourceConnection(context, datasource);

  // Add any missing exposure query ids and check query validity
  settings = await validateExposureQueriesAndAddMissingIds(
    context,
    datasource,
    settings,
    true,
  );

  const model = (await DataSourceModel.create(
    datasource,
  )) as DataSourceDocument;

  const integration = getSourceIntegrationObject(context, datasource);
  if (
    integration.getInformationSchema &&
    integration.getSourceProperties().supportsInformationSchema
  ) {
    logger.debug("queueCreateInformationSchema");
    await queueCreateInformationSchema(datasource.id, context.org.id);
  }

  const datasourceInterface = toInterface(model);
  await audit.logCreate(context, datasourceInterface);
  return datasourceInterface;
}

// Add any missing exposure query ids and validate any new, changed, or previously errored queries
export async function validateExposureQueriesAndAddMissingIds(
  context: ReqContext,
  datasource: DataSourceInterface,
  updates: Partial<DataSourceSettings>,
  forceCheckValidity: boolean = false,
): Promise<Partial<DataSourceSettings>> {
  const updatesCopy = cloneDeep(updates);
  if (updatesCopy.queries?.exposure) {
    await Promise.all(
      updatesCopy.queries.exposure.map(async (exposure) => {
        let checkValidity = forceCheckValidity;
        if (!exposure.id) {
          exposure.id = uniqid("exq_");
          checkValidity = true;
        } else if (!forceCheckValidity) {
          const existingQuery = datasource.settings.queries?.exposure?.find(
            (q) => q.id == exposure.id,
          );
          if (
            !existingQuery ||
            !isEqual(existingQuery, exposure) ||
            existingQuery.error
          ) {
            checkValidity = true;
          }
        }
        if (checkValidity) {
          const integration = getSourceIntegrationObject(context, datasource);
          exposure.error = await testQueryValidity(
            integration,
            exposure,
            context.org.settings?.testQueryDays,
          );
        }
      }),
    );
  }
  return updatesCopy;
}

// Returns true if there are any actual changes, besides dateUpdated, from the actual datasource
export function hasActualChanges(
  datasource: DataSourceInterface,
  updates: Partial<DataSourceInterface>,
) {
  const updateKeys = Object.keys(updates).filter(
    (key) => key !== "dateUpdated",
  ) as Array<keyof DataSourceInterface>;

  return updateKeys.some((key) => !isEqual(datasource[key], updates[key]));
}

export async function updateDataSource(
  context: ReqContext | ApiReqContext,
  datasource: DataSourceInterface,
  updates: Partial<DataSourceInterface>,
) {
  if (usingFileConfig()) {
    throw new Error("Cannot update. Data sources managed by config.yml");
  }

  if (updates.settings) {
    updates.settings = await validateExposureQueriesAndAddMissingIds(
      context,
      datasource,
      updates.settings,
    );
  }
  if (!hasActualChanges(datasource, updates)) {
    return;
  }

  await DataSourceModel.updateOne(
    {
      id: datasource.id,
      organization: context.org.id,
    },
    {
      $set: updates,
    },
  );

  await audit.logUpdate(context, datasource, { ...datasource, ...updates });
}

function isLocked(datasource: DataSourceInterface): boolean {
  if (usingFileConfig() || !datasource.lockUntil) return false;
  return datasource.lockUntil > new Date();
}

export async function lockDataSource(
  context: ReqContext | ApiReqContext,
  datasource: DataSourceInterface,
  seconds: number,
) {
  if (usingFileConfig()) {
    throw new Error("Cannot lock. Data sources managed by config.yml");
  }
  if (datasource.organization !== context.org.id) {
    throw new Error("Cannot lock data source from another organization");
  }

  // Already locked, throw error
  if (isLocked(datasource)) {
    throw new Error(
      "Data source is currently being modified. Please try again later.",
    );
  }

  await DataSourceModel.updateOne(
    {
      id: datasource.id,
      organization: context.org.id,
    },
    {
      $set: { lockUntil: new Date(Date.now() + seconds * 1000) },
    },
  );
}

export async function unlockDataSource(
  context: ReqContext | ApiReqContext,
  datasource: DataSourceInterface,
) {
  if (usingFileConfig()) {
    throw new Error("Cannot unlock. Data sources managed by config.yml");
  }
  if (datasource.organization !== context.org.id) {
    throw new Error("Cannot unlock data source from another organization");
  }

  await DataSourceModel.updateOne(
    {
      id: datasource.id,
      organization: context.org.id,
    },
    {
      $set: { lockUntil: null },
    },
  );
}

// WARNING: This does not restrict by organization
// Only use for deployment-wide actions like migration scripts or superadmin tools
export async function _dangerousGetAllDatasources(): Promise<
  DataSourceInterface[]
> {
  const all: DataSourceDocument[] = await DataSourceModel.find();
  return all.map(toInterface);
}

export function toDataSourceApiInterface(
  datasource: DataSourceInterface,
): ApiDataSource {
  const settings = datasource.settings;
  const obj: ApiDataSource = {
    id: datasource.id,
    dateCreated: datasource.dateCreated?.toISOString() || "",
    dateUpdated: datasource.dateUpdated?.toISOString() || "",
    type: datasource.type,
    name: datasource.name || "",
    description: datasource.description || "",
    projectIds: datasource.projects || [],
    identifierTypes: (settings?.userIdTypes || []).map((identifier) => ({
      id: identifier.userIdType,
      description: identifier.description || "",
    })),
    assignmentQueries: (settings?.queries?.exposure || []).map((q) => ({
      id: q.id,
      name: q.name,
      description: q.description || "",
      identifierType: q.userIdType,
      sql: q.query,
      includesNameColumns: !!q.hasNameCol,
      dimensionColumns: q.dimensions,
      error: q.error,
    })),
    identifierJoinQueries: (settings?.queries?.identityJoins || []).map(
      (q) => ({
        identifierTypes: q.ids,
        sql: q.query,
      }),
    ),
    eventTracker: settings?.schemaFormat || "custom",
  };

  if (datasource.type === "mixpanel") {
    obj.mixpanelSettings = {
      viewedExperimentEventName:
        settings?.events?.experimentEvent || "$experiment_started",
      experimentIdProperty:
        settings?.events?.experimentIdProperty || "Experiment name",
      variationIdProperty:
        settings?.events?.variationIdProperty || "Variant name",
      extraUserIdProperty: settings?.events?.extraUserIdProperty || "",
    };
  }

  return obj;
}
