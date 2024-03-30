import { AES, enc } from "crypto-js";
import { ENCRYPTION_KEY } from "../util/secrets";
import GoogleAnalytics from "../integrations/GoogleAnalytics";
import Athena from "../integrations/Athena";
import Presto from "../integrations/Presto";
import Databricks from "../integrations/Databricks";
import Redshift from "../integrations/Redshift";
import Snowflake from "../integrations/Snowflake";
import Postgres from "../integrations/Postgres";
import { SourceIntegrationInterface, TestQueryRow } from "../types/Integration";
import BigQuery from "../integrations/BigQuery";
import ClickHouse from "../integrations/ClickHouse";
import Mixpanel from "../integrations/Mixpanel";
import {
  DataSourceInterface,
  DataSourceParams,
  DataSourceSettings,
  DataSourceType,
  ExposureQuery,
} from "../../types/datasource";
import Mysql from "../integrations/Mysql";
import Mssql from "../integrations/Mssql";
import { getDataSourceById } from "../models/DataSourceModel";
import { TemplateVariables } from "../../types/sql";
import { ReqContext } from "../../types/organization";
import { ApiReqContext } from "../../types/api";

export function decryptDataSourceParams<T = DataSourceParams>(
  encrypted: string
): T {
  return JSON.parse(AES.decrypt(encrypted, ENCRYPTION_KEY).toString(enc.Utf8));
}

export function encryptParams(params: DataSourceParams): string {
  return AES.encrypt(JSON.stringify(params), ENCRYPTION_KEY).toString();
}

export function getNonSensitiveParams(integration: SourceIntegrationInterface) {
  const ret = { ...integration.params };
  integration.getSensitiveParamKeys().forEach((k) => {
    if (ret[k]) {
      ret[k] = "";
    }
  });
  return ret;
}

export function mergeParams(
  integration: SourceIntegrationInterface,
  newParams: Partial<DataSourceParams>
) {
  const secretKeys = integration.getSensitiveParamKeys();
  Object.keys(newParams).forEach((k: keyof DataSourceParams) => {
    // If a secret value is left empty, keep the original value
    if (secretKeys.includes(k) && !newParams[k]) return;
    integration.params[k] = newParams[k];
  });
}

function getIntegrationObj(
  type: DataSourceType,
  params: string,
  settings: DataSourceSettings
): SourceIntegrationInterface {
  switch (type) {
    case "athena":
      return new Athena(params, settings);
    case "redshift":
      return new Redshift(params, settings);
    case "google_analytics":
      return new GoogleAnalytics(params, settings);
    case "snowflake":
      return new Snowflake(params, settings);
    case "postgres":
      return new Postgres(params, settings);
    case "mysql":
      return new Mysql(params, settings);
    case "mssql":
      return new Mssql(params, settings);
    case "bigquery":
      return new BigQuery(params, settings);
    case "clickhouse":
      return new ClickHouse(params, settings);
    case "mixpanel":
      return new Mixpanel(params, settings ?? {});
    case "presto":
      return new Presto(params, settings);
    case "databricks":
      return new Databricks(params, settings);
  }
}

export async function getIntegrationFromDatasourceId(
  context: ReqContext | ApiReqContext,
  id: string,
  throwOnDecryptionError: boolean = false
) {
  const datasource = await getDataSourceById(context, id);
  if (!datasource) {
    throw new Error("Could not load data source");
  }
  return getSourceIntegrationObject(datasource, throwOnDecryptionError);
}

export function getSourceIntegrationObject(
  datasource: DataSourceInterface,
  throwOnDecryptionError: boolean = false
) {
  const { type, params, settings } = datasource;

  const obj = getIntegrationObj(type, params, settings);

  // Sanity check, this should never happen
  if (!obj) {
    throw new Error("Unknown data source type: " + type);
  }

  obj.organization = datasource.organization;
  obj.datasource = datasource.id;
  obj.type = datasource.type;

  if (throwOnDecryptionError && obj.decryptionError) {
    throw new Error(
      "Could not decrypt data source credentials. View the data source settings for more info."
    );
  }

  return obj;
}

export async function testDataSourceConnection(
  datasource: DataSourceInterface
) {
  const integration = getSourceIntegrationObject(datasource);
  await integration.testConnection();
}

export async function testQuery(
  datasource: DataSourceInterface,
  query: string,
  templateVariables?: TemplateVariables
): Promise<{
  results?: TestQueryRow[];
  duration?: number;
  error?: string;
  sql?: string;
}> {
  const integration = getSourceIntegrationObject(datasource);

  // The Mixpanel integration does not support test queries
  if (!integration.getTestQuery || !integration.runTestQuery) {
    throw new Error("Unable to test query.");
  }

  const sql = integration.getTestQuery(query, templateVariables);
  try {
    const { results, duration } = await integration.runTestQuery(sql, [
      "timestamp",
    ]);
    return {
      results,
      duration,
      sql,
    };
  } catch (e) {
    return {
      error: e.message,
      sql,
    };
  }
}

// Return any errors that result when running the query otherwise return undefined
export async function testQueryValidity(
  integration: SourceIntegrationInterface,
  query: ExposureQuery
): Promise<string | undefined> {
  // The Mixpanel integration does not support test queries
  if (!integration.getTestValidityQuery || !integration.runTestQuery) {
    return undefined;
  }

  const requiredColumns = new Set([
    "experiment_id",
    "variation_id",
    "timestamp",
    query.userIdType,
    ...query.dimensions,
    ...(query.hasNameCol ? ["experiment_name", "variation_name"] : []),
  ]);

  const sql = integration.getTestValidityQuery(query.query);
  try {
    const results = await integration.runTestQuery(sql);
    if (results.results.length === 0) {
      return "No rows returned";
    }
    const columns = new Set(Object.keys(results.results[0]));

    const missingColumns: string[] = [];
    for (const col of requiredColumns) {
      if (!columns.has(col)) {
        missingColumns.push(col);
      }
    }

    if (missingColumns.length > 0) {
      return `Missing required columns in response: ${missingColumns.join(
        ", "
      )}`;
    }

    return undefined;
  } catch (e) {
    return e.message;
  }
}
