import { AES, enc } from "crypto-js";
import { ENCRYPTION_KEY } from "../util/secrets";
import GoogleAnalytics from "../integrations/GoogleAnalytics";
import Athena from "../integrations/Athena";
import Presto from "../integrations/Presto";
import Redshift from "../integrations/Redshift";
import Snowflake from "../integrations/Snowflake";
import Postgres from "../integrations/Postgres";
import { SourceIntegrationInterface } from "../types/Integration";
import BigQuery from "../integrations/BigQuery";
import ClickHouse from "../integrations/ClickHouse";
import Mixpanel from "../integrations/Mixpanel";
import { DataSourceInterface, DataSourceParams } from "../../types/datasource";
import Mysql from "../integrations/Mysql";

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
  } else if (type === "mysql") {
    obj = new Mysql(params, settings);
  } else if (type === "bigquery") {
    obj = new BigQuery(params, settings);
  } else if (type === "clickhouse") {
    obj = new ClickHouse(params, settings);
  } else if (type === "mixpanel") {
    obj = new Mixpanel(params, settings);
  } else if (type === "presto") {
    obj = new Presto(params, settings);
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
