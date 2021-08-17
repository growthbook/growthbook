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
  testDataSourceConnection,
} from "../services/datasource";
import uniqid from "uniqid";
import { usingFileConfig, getConfigDatasources } from "../init/config";

const dataSourceSchema = new mongoose.Schema({
  id: {
    type: String,
    unique: true,
  },
  name: String,
  organization: {
    type: String,
    index: true,
  },
  dateCreated: Date,
  dateUpdated: Date,
  type: { type: String },
  params: String,
  settings: {
    queries: {
      usersQuery: String,
      experimentsQuery: String,
      pageviewsQuery: String,
    },
    events: {
      experimentEvent: String,
      experimentIdProperty: String,
      variationIdProperty: String,
      pageviewEvent: String,
      urlProperty: String,
      userAgentProperty: String,
    },
    variationIdFormat: String,

    // Deprecated
    default: {
      timestampColumn: String,
      userIdColumn: String,
      anonymousIdColumn: String,
    },
    experiments: {
      table: String,
      timestampColumn: String,
      userIdColumn: String,
      anonymousIdColumn: String,
      experimentIdColumn: String,
      variationColumn: String,
      variationFormat: String,
    },
    users: {
      table: String,
      userIdColumn: String,
    },
    identifies: {
      table: String,
      userIdColumn: String,
      anonymousIdColumn: String,
    },
    pageviews: {
      table: String,
      urlColumn: String,
      timestampColumn: String,
      userIdColumn: String,
      anonymousIdColumn: String,
    },
  },
});
type DataSourceDocument = mongoose.Document & DataSourceInterface;

const DataSourceModel = mongoose.model<DataSourceDocument>(
  "DataSource",
  dataSourceSchema
);

function toInterface(doc: DataSourceDocument): DataSourceInterface {
  if (!doc) return null;
  return doc.toJSON();
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
  });

  if (doc && doc.organization !== organization) {
    throw new Error("You do not have access to that datasource");
  }

  return toInterface(doc);
}

export async function getOrganizationsWithDatasources(): Promise<string[]> {
  if (usingFileConfig()) {
    return [];
  }
  return await DataSourceModel.distinct("organization");
}
export async function deleteDatasourceById(id: string) {
  if (usingFileConfig()) {
    throw new Error("Cannot delete. Data sources managed by config.yml");
  }
  await DataSourceModel.deleteOne({
    id,
  });
}

export async function createDataSource(
  organization: string,
  name: string,
  type: DataSourceType,
  params: DataSourceParams,
  settings?: DataSourceSettings
) {
  if (usingFileConfig()) {
    throw new Error("Cannot add. Data sources managed by config.yml");
  }

  const id = uniqid("ds_");

  if (type === "google_analytics") {
    const oauth2Client = getOauth2Client();
    const { tokens } = await oauth2Client.getToken(
      (params as GoogleAnalyticsParams).refreshToken
    );
    (params as GoogleAnalyticsParams).refreshToken = tokens.refresh_token;
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
  updates: Partial<DataSourceInterface>
) {
  if (usingFileConfig()) {
    throw new Error("Cannot update. Data sources managed by config.yml");
  }

  await DataSourceModel.updateOne(
    {
      id,
    },
    {
      $set: updates,
    }
  );
}
