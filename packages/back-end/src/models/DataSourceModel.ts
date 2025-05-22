import mongoose from "mongoose";
import uniqid from "uniqid";
import { cloneDeep, isEqual } from "lodash";
import {
  DataSourceInterface,
  DataSourceParams,
  DataSourceSettings,
  DataSourceType,
  GrowthbookClickhouseDataSource,
  MaterializedColumn,
} from "back-end/types/datasource";
import { GoogleAnalyticsParams } from "back-end/types/integrations/googleanalytics";
import { getOauth2Client } from "back-end/src/integrations/GoogleAnalytics";
import {
  createDataSourceObject,
  encryptParams,
  getSourceIntegrationObject,
  isDataSourceType,
  isPartialWithMaterializedColumns,
  testDataSourceConnection,
  testQueryValidity,
} from "back-end/src/services/datasource";
import {
  usingFileConfig,
  getConfigDatasources,
} from "back-end/src/init/config";
import { upgradeDatasourceObject } from "back-end/src/util/migrations";
import { ApiDataSource } from "back-end/types/openapi";
import { queueCreateInformationSchema } from "back-end/src/jobs/createInformationSchema";
import { IS_CLOUD } from "back-end/src/util/secrets";
import { ReqContext } from "back-end/types/organization";
import { ApiReqContext } from "back-end/types/api";
import { logger } from "back-end/src/util/logger";
import {
  deleteClickhouseUser,
  updateMaterializedColumns,
} from "back-end/src/services/clickhouse";

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
});
dataSourceSchema.index({ id: 1, organization: 1 }, { unique: true });
type DataSourceDocument = mongoose.Document & DataSourceInterface;

const DataSourceModel = mongoose.model<DataSourceInterface>(
  "DataSource",
  dataSourceSchema
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
  context: ReqContext | ApiReqContext
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
    context.permissions.canReadMultiProjectResource(ds.projects)
  );
}

// WARNING: This does not restrict by organization
export async function _dangerourslyGetAllDatasourcesByOrganizations(
  organizations: string[]
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
  id: string
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

export async function removeProjectFromDatasources(
  project: string,
  organization: string
) {
  await DataSourceModel.updateMany(
    { organization, projects: project },
    { $pull: { projects: project } }
  );
}

export async function deleteDatasource(
  datasource: DataSourceInterface,
  organization: string
) {
  if (usingFileConfig()) {
    throw new Error("Cannot delete. Data sources managed by config.yml");
  }
  if (datasource.type === "growthbook_clickhouse") {
    await deleteClickhouseUser(datasource.id, organization);
  }
  await DataSourceModel.deleteOne({
    id: datasource.id,
    organization,
  });
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
  projects?: string[]
) {
  if (usingFileConfig()) {
    throw new Error("Cannot add. Data sources managed by config.yml");
  }

  id = id || uniqid("ds_");
  projects = projects || [];

  if (type === "google_analytics") {
    const oauth2Client = getOauth2Client();
    const { tokens } = await oauth2Client.getToken(
      (params as GoogleAnalyticsParams).refreshToken
    );
    (params as GoogleAnalyticsParams).refreshToken = tokens.refresh_token || "";
  }

  const datasource = createDataSourceObject(type, {
    id,
    name,
    description,
    organization: context.org.id,
    settings,
    dateCreated: new Date(),
    dateUpdated: new Date(),
    params: encryptParams(params),
    projects,
  });

  await testDataSourceConnection(context, datasource);

  // Add any missing exposure query ids and check query validity
  settings = await validateExposureQueriesAndAddMissingIds(
    context,
    datasource,
    settings,
    true
  );

  const model = (await DataSourceModel.create(
    datasource
  )) as DataSourceDocument;

  const integration = getSourceIntegrationObject(context, datasource);
  if (
    integration.getInformationSchema &&
    integration.getSourceProperties().supportsInformationSchema
  ) {
    logger.debug("queueCreateInformationSchema");
    await queueCreateInformationSchema(datasource.id, context.org.id);
  }

  return toInterface(model);
}

// Add any missing exposure query ids and validate any new, changed, or previously errored queries
export async function validateExposureQueriesAndAddMissingIds(
  context: ReqContext,
  datasource: DataSourceInterface,
  updates: Partial<DataSourceSettings>,
  forceCheckValidity: boolean = false
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
            (q) => q.id == exposure.id
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
            context.org.settings?.testQueryDays
          );
        }
      })
    );
  }
  return updatesCopy;
}

// Returns true if there are any actual changes, besides dateUpdated, from the actual datasource
export function hasActualChanges(
  datasource: DataSourceInterface,
  updates: Partial<DataSourceInterface>
) {
  const updateKeys = Object.keys(updates).filter(
    (key) => key !== "dateUpdated"
  ) as Array<keyof DataSourceInterface>;

  return updateKeys.some((key) => !isEqual(datasource[key], updates[key]));
}

export async function updateDataSource(
  context: ReqContext | ApiReqContext,
  datasource: DataSourceInterface,
  updates: Partial<DataSourceInterface>
) {
  if (usingFileConfig()) {
    throw new Error("Cannot update. Data sources managed by config.yml");
  }

  if (updates.settings) {
    updates.settings = await validateExposureQueriesAndAddMissingIds(
      context,
      datasource,
      updates.settings
    );
  }
  if (!hasActualChanges(datasource, updates)) {
    return;
  }

  if (
    isDataSourceType<GrowthbookClickhouseDataSource>(
      datasource,
      "growthbook_clickhouse"
    ) &&
    isPartialWithMaterializedColumns(updates)
  ) {
    updates.settings!.materializedColumns = sanitizeMaterializedColumns(
      updates.settings!.materializedColumns!
    );
    const finalColumns = updates.settings!.materializedColumns!;

    const originalColumns = sanitizeMaterializedColumns(
      datasource.settings.materializedColumns || []
    );
    const newColumnMap = Object.fromEntries(
      finalColumns.map((col) => [col.sourceField, col])
    );
    const originalColumnMap = Object.fromEntries(
      originalColumns.map((col) => [col.sourceField, col])
    );
    const columnsToDelete: MaterializedColumn[] = [],
      columnsToRename: { from: string; to: string }[] = [];

    originalColumns.forEach((col) => {
      if (
        !Object.prototype.hasOwnProperty.call(newColumnMap, col.sourceField)
      ) {
        columnsToDelete.push(col);
        return;
      }
      if (newColumnMap[col.sourceField].columnName !== col.columnName) {
        columnsToRename.push({
          from: col.columnName,
          to: newColumnMap[col.sourceField].columnName,
        });
        return;
      }
      // Prevent changing column type for existing columns
      if (newColumnMap[col.sourceField].datatype !== col.datatype) {
        const updateColumn = updates.settings!.materializedColumns!.find(
          (c) => c.sourceField === col.sourceField
        );
        if (updateColumn) {
          updateColumn.datatype = col.datatype;
        }
      }
    });
    const columnsToAdd = Object.values(newColumnMap).filter(
      (col) =>
        !Object.prototype.hasOwnProperty.call(
          originalColumnMap,
          col.sourceField
        )
    );
    await updateMaterializedColumns({
      datasource,
      columnsToAdd,
      columnsToDelete,
      columnsToRename,
      finalColumns,
      originalColumns,
    });
  }

  await DataSourceModel.updateOne(
    {
      id: datasource.id,
      organization: context.org.id,
    },
    {
      $set: updates,
    }
  );
}

function sanitizeMaterializedColumns(unsafeColumns: MaterializedColumn[]) {
  return unsafeColumns.map(({ columnName, datatype, sourceField }) => ({
    columnName: sanitizeMatColumnString(columnName, true),
    datatype,
    sourceField: sanitizeMatColumnString(sourceField, false),
  }));
}

function sanitizeMatColumnString(userInput: string, replaceSpaces: boolean) {
  if (!/^[a-zA-Z_][a-zA-Z0-9 _-]*$/.test(userInput)) {
    throw new Error(
      "Invalid input. Field names must start with a letter or underscore and only use alphanumeric characters or ' ', '_', or '-'"
    );
  }
  if (replaceSpaces) return userInput.replace(/[ -]/g, "_");
  return userInput;
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
  datasource: DataSourceInterface
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
      })
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
