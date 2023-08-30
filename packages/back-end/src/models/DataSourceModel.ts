import mongoose from "mongoose";
import uniqid from "uniqid";
import { cloneDeep, isEqual } from "lodash";
import {
  DataSourceInterface,
  DataSourceParams,
  DataSourceSettings,
  DataSourceType,
} from "../../types/datasource";
import { GoogleAnalyticsParams } from "../../types/integrations/googleanalytics";
import { getOauth2Client } from "../integrations/GoogleAnalytics";
import {
  encryptParams,
  getSourceIntegrationObject,
  testDataSourceConnection,
  testQueryValidity,
} from "../services/datasource";
import { usingFileConfig, getConfigDatasources } from "../init/config";
import { upgradeDatasourceObject } from "../util/migrations";
import { ApiDataSource } from "../../types/openapi";
import { queueCreateInformationSchema } from "../jobs/createInformationSchema";

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
  type: { type: String },
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

export async function getDataSourcesByOrganization(
  organization: string
): Promise<DataSourceInterface[]> {
  // If using config.yml, immediately return the list from there
  if (usingFileConfig()) {
    return getConfigDatasources(organization);
  }

  const docs: DataSourceDocument[] = await DataSourceModel.find({
    organization,
  });

  return docs.map(toInterface);
}

export async function getDataSourceById(id: string, organization: string) {
  // If using config.yml, immediately return the from there
  if (usingFileConfig()) {
    return (
      getConfigDatasources(organization).filter((d) => d.id === id)[0] || null
    );
  }

  const doc: DataSourceDocument | null = await DataSourceModel.findOne({
    id,
    organization,
  });

  return doc ? toInterface(doc) : null;
}
export async function getDataSourcesByIds(ids: string[], organization: string) {
  // If using config.yml, immediately return the list from there
  if (usingFileConfig()) {
    return (
      getConfigDatasources(organization).filter((d) => ids.includes(d.id)) || []
    );
  }

  const docs: DataSourceDocument[] = await DataSourceModel.find({
    id: { $in: ids },
    organization,
  });

  return docs.map(toInterface);
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

export async function getOrganizationsWithDatasources(): Promise<string[]> {
  if (usingFileConfig()) {
    return [];
  }
  return await DataSourceModel.distinct("organization");
}
export async function deleteDatasourceById(id: string, organization: string) {
  if (usingFileConfig()) {
    throw new Error("Cannot delete. Data sources managed by config.yml");
  }
  await DataSourceModel.deleteOne({
    id,
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
  organization: string,
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

  const datasource: DataSourceInterface = {
    id,
    name,
    description,
    organization,
    type,
    settings,
    dateCreated: new Date(),
    dateUpdated: new Date(),
    params: encryptParams(params),
    projects,
  };

  await testDataSourceConnection(datasource);

  // Add any missing exposure query ids and check query validity
  settings = await validateExposureQueriesAndAddMissingIds(
    datasource,
    settings,
    true
  );

  const model = (await DataSourceModel.create(
    datasource
  )) as DataSourceDocument;

  const integration = getSourceIntegrationObject(datasource);
  if (
    integration.getInformationSchema &&
    integration.getSourceProperties().supportsInformationSchema
  ) {
    await queueCreateInformationSchema(datasource.id, organization);
  }

  return toInterface(model);
}

// Add any missing exposure query ids and validate any new, changed, or previously errored queries
export async function validateExposureQueriesAndAddMissingIds(
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
          const integration = getSourceIntegrationObject(datasource);
          exposure.error = await testQueryValidity(integration, exposure);
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
  datasource: DataSourceInterface,
  organization: string,
  updates: Partial<DataSourceInterface>
) {
  if (usingFileConfig()) {
    throw new Error("Cannot update. Data sources managed by config.yml");
  }

  if (updates.settings) {
    updates.settings = await validateExposureQueriesAndAddMissingIds(
      datasource,
      updates.settings
    );
  }
  if (!hasActualChanges(datasource, updates)) {
    return;
  }

  await DataSourceModel.updateOne(
    {
      id: datasource.id,
      organization,
    },
    {
      $set: updates,
    }
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
