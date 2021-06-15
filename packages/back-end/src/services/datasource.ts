import uniqid from "uniqid";
import { AES, enc } from "crypto-js";
import { ENCRYPTION_KEY } from "../util/secrets";
import GoogleAnalytics, {
  getOauth2Client,
} from "../integrations/GoogleAnalytics";
import Athena from "../integrations/Athena";
import Redshift from "../integrations/Redshift";
import Snowflake from "../integrations/Snowflake";
import Postgres from "../integrations/Postgres";
import { SourceIntegrationInterface } from "../types/Integration";
import BigQuery from "../integrations/BigQuery";
import ClickHouse from "../integrations/ClickHouse";
import Mixpanel from "../integrations/Mixpanel";
import { DataSourceModel } from "../models/DataSourceModel";
import {
  DataSourceInterface,
  DataSourceParams,
  DataSourceSettings,
  DataSourceType,
} from "../../types/datasource";
import { GoogleAnalyticsParams } from "../../types/integrations/googleanalytics";

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
export function decryptDataSourceParams<T = DataSourceParams>(
  encrypted: string
): T {
  return JSON.parse(AES.decrypt(encrypted, ENCRYPTION_KEY).toString(enc.Utf8));
}

export function encryptParams(params: DataSourceParams): string {
  return AES.encrypt(JSON.stringify(params), ENCRYPTION_KEY).toString();
}

export function mergeAndEncryptParams(
  newParams: Partial<DataSourceParams>,
  existingParams: string
): string {
  const params = decryptDataSourceParams(existingParams);
  Object.assign(params, newParams);
  return encryptParams(params);
}

export function getSourceIntegrationObject(datasource: DataSourceInterface) {
  const { type, params, settings } = datasource;

  let obj: SourceIntegrationInterface;
  if (type === "athena") {
    obj = new Athena(params, settings);
  } else if (type === "redshift") {
    obj = new Redshift(params, settings);
  } else if (type === "google_analytics") {
    obj = new GoogleAnalytics(params, settings);
  } else if (type === "snowflake") {
    obj = new Snowflake(params, settings);
  } else if (type === "postgres") {
    obj = new Postgres(params, settings);
  } else if (type === "bigquery") {
    obj = new BigQuery(params, settings);
  } else if (type === "clickhouse") {
    obj = new ClickHouse(params, settings);
  } else if (type === "mixpanel") {
    obj = new Mixpanel(params, settings);
  } else {
    throw new Error("Unknown data source type: " + type);
  }

  obj.organization = datasource.organization;
  obj.datasource = datasource.id;

  return obj;
}

export async function testDataSourceConnection(
  datasource: DataSourceInterface
) {
  const integration = getSourceIntegrationObject(datasource);
  await integration.testConnection();
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
