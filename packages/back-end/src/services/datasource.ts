import { AES, enc } from "crypto-js";
import { ENCRYPTION_KEY } from "back-end/src/util/secrets";
import GoogleAnalytics from "back-end/src/integrations/GoogleAnalytics";
import Athena from "back-end/src/integrations/Athena";
import Presto from "back-end/src/integrations/Presto";
import Databricks from "back-end/src/integrations/Databricks";
import Redshift from "back-end/src/integrations/Redshift";
import Snowflake from "back-end/src/integrations/Snowflake";
import Postgres from "back-end/src/integrations/Postgres";
import Vertica from "back-end/src/integrations/Vertica";
import BigQuery from "back-end/src/integrations/BigQuery";
import ClickHouse from "back-end/src/integrations/ClickHouse";
import Mixpanel from "back-end/src/integrations/Mixpanel";
import {
  SourceIntegrationInterface,
  TestQueryRow,
} from "back-end/src/types/Integration";
import {
  DataSourceInterface,
  DataSourceParams,
  ExposureQuery,
} from "back-end/types/datasource";
import Mysql from "back-end/src/integrations/Mysql";
import Mssql from "back-end/src/integrations/Mssql";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import { TemplateVariables } from "back-end/types/sql";
import { ReqContext } from "back-end/types/organization";
import { ApiReqContext } from "back-end/types/api";

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
  context: ReqContext,
  datasource: DataSourceInterface
): SourceIntegrationInterface {
  switch (datasource.type) {
    case "growthbook_clickhouse":
      return new ClickHouse(context, datasource);
    case "athena":
      return new Athena(context, datasource);
    case "redshift":
      return new Redshift(context, datasource);
    case "google_analytics":
      return new GoogleAnalytics(context, datasource);
    case "snowflake":
      return new Snowflake(context, datasource);
    case "postgres":
      return new Postgres(context, datasource);
    case "vertica":
      return new Vertica(context, datasource);
    case "mysql":
      return new Mysql(context, datasource);
    case "mssql":
      return new Mssql(context, datasource);
    case "bigquery":
      return new BigQuery(context, datasource);
    case "clickhouse":
      return new ClickHouse(context, datasource);
    case "mixpanel":
      return new Mixpanel(context, datasource);
    case "presto":
      return new Presto(context, datasource);
    case "databricks":
      return new Databricks(context, datasource);
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
  return getSourceIntegrationObject(
    context,
    datasource,
    throwOnDecryptionError
  );
}

export function getSourceIntegrationObject(
  context: ReqContext | ApiReqContext,
  datasource: DataSourceInterface,
  throwOnDecryptionError: boolean = false
) {
  const obj = getIntegrationObj(context, datasource);

  // Sanity check, this should never happen
  if (!obj) {
    throw new Error("Unknown data source type: " + datasource.type);
  }

  if (throwOnDecryptionError && obj.decryptionError) {
    throw new Error(
      "Could not decrypt data source credentials. View the data source settings for more info."
    );
  }

  return obj;
}

export async function testDataSourceConnection(
  context: ReqContext,
  datasource: DataSourceInterface
) {
  const integration = getSourceIntegrationObject(context, datasource);
  await integration.testConnection();
}

export async function testQuery(
  context: ReqContext,
  datasource: DataSourceInterface,
  query: string,
  templateVariables?: TemplateVariables
): Promise<{
  results?: TestQueryRow[];
  duration?: number;
  error?: string;
  sql?: string;
}> {
  if (!context.permissions.canRunTestQueries(datasource)) {
    throw new Error("Permission denied");
  }

  const integration = getSourceIntegrationObject(context, datasource);

  // The Mixpanel integration does not support test queries
  if (!integration.getTestQuery || !integration.runTestQuery) {
    throw new Error("Unable to test query.");
  }

  const sql = integration.getTestQuery({
    query,
    templateVariables,
    testDays: context.org.settings?.testQueryDays,
  });
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
