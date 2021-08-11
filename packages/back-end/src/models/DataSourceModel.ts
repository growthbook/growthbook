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
export type DataSourceDocument = mongoose.Document & DataSourceInterface;

const DataSourceModel = mongoose.model<DataSourceDocument>(
  "DataSource",
  dataSourceSchema
);

export function getOrganizationsWithDatasources() {
  return DataSourceModel.distinct("organization");
}
export function deleteDatasourceById(id: string) {
  DataSourceModel.deleteOne({
    id,
  });
}
export async function getDataSourcesByOrganization(organization: string) {
  return await DataSourceModel.find({
    organization,
  });
}
export async function getDataSourceById(id: string) {
  return await DataSourceModel.findOne({
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

  return model;
}
