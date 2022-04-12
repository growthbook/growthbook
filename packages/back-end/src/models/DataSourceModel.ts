import mongoose from "mongoose";
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
} from "../services/datasource";
import uniqid from "uniqid";
import { usingFileConfig, getConfigDatasources } from "../init/config";
import SqlIntegration from "../integrations/SqlIntegration";

const dataSourceSchema = new mongoose.Schema({
  id: String,
  name: String,
  organization: {
    type: String,
    index: true,
  },
  dateCreated: Date,
  dateUpdated: Date,
  type: { type: String },
  params: String,
  settings: {},
});
dataSourceSchema.index({ id: 1, organization: 1 }, { unique: true });
type DataSourceDocument = mongoose.Document & DataSourceInterface;

const DataSourceModel = mongoose.model<DataSourceDocument>(
  "DataSource",
  dataSourceSchema
);

function toInterface(doc: DataSourceDocument): DataSourceInterface {
  return upgradeDatasourceObject(doc.toJSON());
}

function getDefaultExperimentQuery(
  settings: DataSourceSettings,
  userIdType = "user_id",
  schema?: string
): string {
  let column = userIdType;

  if (userIdType === "user_id") {
    column =
      settings?.experiments?.userIdColumn ||
      settings?.default?.userIdColumn ||
      "user_id";
  } else if (userIdType === "anonymous_id") {
    column =
      settings?.experiments?.anonymousIdColumn ||
      settings?.default?.anonymousIdColumn ||
      "anonymous_id";
  }

  return `SELECT
  ${column} as ${userIdType},
  ${
    settings?.experiments?.timestampColumn ||
    settings?.default?.timestampColumn ||
    "received_at"
  } as timestamp,
  ${
    settings?.experiments?.experimentIdColumn || "experiment_id"
  } as experiment_id,
  ${settings?.experiments?.variationColumn || "variation_id"} as variation_id
FROM 
  ${schema && !settings?.experiments?.table?.match(/\./) ? schema + "." : ""}${
    settings?.experiments?.table || "experiment_viewed"
  }`;
}

export function upgradeDatasourceObject(
  datasource: DataSourceInterface
): DataSourceInterface {
  const settings = datasource.settings;

  // Add default randomization units
  if (!settings?.userIdTypes) {
    settings.userIdTypes = [
      {
        id: "user_id",
        description: "Logged-in User Id",
      },
      {
        id: "anonymous_id",
        description: "Anonymous Visitor id",
      },
    ];
  }

  // Upgrade old docs to the new exposure queries format
  if (!settings?.queries?.exposure) {
    const integration = getSourceIntegrationObject(datasource);
    if (integration instanceof SqlIntegration) {
      settings.queries = settings.queries || {};
      settings.queries.exposure = [
        {
          id: "user_id",
          name: "Logged-in User Experiments",
          description: "",
          userIdType: "user_id",
          dimensions: settings.experimentDimensions || [],
          query:
            settings.queries.experimentsQuery ||
            getDefaultExperimentQuery(
              settings,
              "user_id",
              integration.getSchema()
            ),
        },
        {
          id: "anonymous_id",
          name: "Anonymous Visitor Experiments",
          description: "",
          userIdType: "anonymous_id",
          dimensions: settings.experimentDimensions || [],
          query:
            settings.queries.experimentsQuery ||
            getDefaultExperimentQuery(
              settings,
              "anonymous_id",
              integration.getSchema()
            ),
        },
      ];
    }
  }

  return datasource;
}

export async function getDataSourcesByOrganization(organization: string) {
  // If using config.yml, immediately return the list from there
  if (usingFileConfig()) {
    return getConfigDatasources(organization);
  }

  return (
    await DataSourceModel.find({
      organization,
    })
  ).map(toInterface);
}
export async function getDataSourceById(id: string, organization: string) {
  // If using config.yml, immediately return the from there
  if (usingFileConfig()) {
    return (
      getConfigDatasources(organization).filter((d) => d.id === id)[0] || null
    );
  }

  const doc = await DataSourceModel.findOne({
    id,
    organization,
  });

  return doc ? toInterface(doc) : null;
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

export async function createDataSource(
  organization: string,
  name: string,
  type: DataSourceType,
  params: DataSourceParams,
  settings: DataSourceSettings,
  id?: string
) {
  if (usingFileConfig()) {
    throw new Error("Cannot add. Data sources managed by config.yml");
  }

  id = id || uniqid("ds_");

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
    organization,
    type,
    settings,
    dateCreated: new Date(),
    dateUpdated: new Date(),
    params: encryptParams(params),
  };

  // Test the connection and create in the database
  await testDataSourceConnection(datasource);
  const model = await DataSourceModel.create(datasource);

  return toInterface(model);
}

export async function updateDataSource(
  id: string,
  organization: string,
  updates: Partial<DataSourceInterface>
) {
  if (usingFileConfig()) {
    throw new Error("Cannot update. Data sources managed by config.yml");
  }

  await DataSourceModel.updateOne(
    {
      id,
      organization,
    },
    {
      $set: updates,
    }
  );
}
