import { AES, enc } from "crypto-js";
import { isReadOnlySQL } from "shared/sql";
import { TemplateVariables } from "shared/types/sql";
import {
  FeatureEvalDiagnosticsQueryResponseRows,
  TestQueryRow,
  UserExperimentExposuresQueryResponseRows,
} from "shared/types/integrations";
import {
  DataSourceInterface,
  DataSourceParams,
  ExposureQuery,
} from "shared/types/datasource";
import { QueryStatistics } from "shared/types/query";
import { SQLExecutionError } from "back-end/src/util/errors";
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
import { SourceIntegrationInterface } from "back-end/src/types/Integration";
import Mysql from "back-end/src/integrations/Mysql";
import Mssql from "back-end/src/integrations/Mssql";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import { ReqContext } from "back-end/types/request";
import { ApiReqContext } from "back-end/types/api";

export function decryptDataSourceParams<T = DataSourceParams>(
  encrypted: string,
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
  newParams: Partial<DataSourceParams>,
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
  datasource: DataSourceInterface,
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
  throwOnDecryptionError: boolean = false,
) {
  const datasource = await getDataSourceById(context, id);
  if (!datasource) {
    throw new Error("Could not load data source");
  }
  return getSourceIntegrationObject(
    context,
    datasource,
    throwOnDecryptionError,
  );
}

export function getSourceIntegrationObject(
  context: ReqContext | ApiReqContext,
  datasource: DataSourceInterface,
  throwOnDecryptionError: boolean = false,
) {
  const obj = getIntegrationObj(context, datasource);

  // Sanity check, this should never happen
  if (!obj) {
    throw new Error("Unknown data source type: " + datasource.type);
  }

  if (throwOnDecryptionError && obj.decryptionError) {
    throw new Error(
      "Could not decrypt data source credentials. View the data source settings for more info.",
    );
  }

  return obj;
}

export async function testDataSourceConnection(
  context: ReqContext,
  datasource: DataSourceInterface,
) {
  const integration = getSourceIntegrationObject(context, datasource);
  await integration.testConnection();
}

export async function runFreeFormQuery(
  context: ReqContext,
  datasource: DataSourceInterface,
  query: string,
  limit?: number,
): Promise<{
  results?: TestQueryRow[];
  duration?: number;
  error?: string;
  sql?: string;
  limit?: number;
}> {
  if (!context.permissions.canRunSqlExplorerQueries(datasource)) {
    throw new Error("Permission denied");
  }

  if (!isReadOnlySQL(query)) {
    throw new Error("Only SELECT queries are allowed.");
  }

  const integration = getSourceIntegrationObject(context, datasource);

  // The Mixpanel integration does not support test queries
  if (!integration.getFreeFormQuery || !integration.runTestQuery) {
    throw new Error("Unable to test query.");
  }

  const sql = integration.getFreeFormQuery(query, limit);
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

export async function runUserExposureQuery(
  context: ReqContext,
  datasource: DataSourceInterface,
  unitId: string,
  userIdType: string,
  lookbackDays: number,
): Promise<{
  rows?: UserExperimentExposuresQueryResponseRows;
  statistics?: QueryStatistics;
  error?: string;
  sql?: string;
}> {
  if (!context.permissions.canRunExperimentQueries(datasource)) {
    throw new Error("Permission denied");
  }

  const integration = getSourceIntegrationObject(context, datasource);

  // The Mixpanel and GA integrations do not support user exposures queries
  if (
    !integration.getUserExperimentExposuresQuery ||
    !integration.runUserExperimentExposuresQuery
  ) {
    throw new Error("Unable to run user exposures query.");
  }

  const sql = integration.getUserExperimentExposuresQuery({
    unitId,
    userIdType,
    lookbackDays,
  });

  try {
    const { rows, statistics } =
      await integration.runUserExperimentExposuresQuery(sql);
    return {
      rows,
      statistics,
      sql,
    };
  } catch (e) {
    return {
      error: e.message,
      sql,
    };
  }
}

export async function runFeatureEvalDiagnosticsQuery(
  context: ReqContext,
  datasource: DataSourceInterface,
  feature: string,
): Promise<{
  rows?: FeatureEvalDiagnosticsQueryResponseRows;
  statistics?: QueryStatistics;
  sql?: string;
}> {
  if (!context.permissions.canRunFeatureDiagnosticsQueries(datasource)) {
    context.permissions.throwPermissionError();
  }

  const integration = getSourceIntegrationObject(context, datasource);

  // The Mixpanel and GA integrations do not support feature usage queries
  if (
    !integration.getFeatureEvalDiagnosticsQuery ||
    !integration.runFeatureEvalDiagnosticsQuery
  ) {
    throw new Error(
      "Datasource does not support feature evaluation diagnostics queries.",
    );
  }

  const sql = integration.getFeatureEvalDiagnosticsQuery({
    feature,
  });

  try {
    const { rows, statistics } =
      await integration.runFeatureEvalDiagnosticsQuery(sql);
    return {
      rows,
      statistics,
      sql,
    };
  } catch (e) {
    throw new SQLExecutionError(e.message, sql);
  }
}

export async function testQuery(
  context: ReqContext,
  datasource: DataSourceInterface,
  query: string,
  templateVariables?: TemplateVariables,
  limit?: number,
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
    limit,
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
  query: ExposureQuery,
  testDays?: number,
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

  const sql = integration.getTestValidityQuery(query.query, testDays);
  try {
    const results = await integration.runTestQuery(sql);

    let columns: Set<string>;

    // For datasources supporting LIMIT 0, use column metadata
    if (integration.supportsLimitZeroColumnValidation?.()) {
      const columnNames = results.columns?.map((c) => c.name) || [];
      if (columnNames.length === 0) {
        return "Unable to determine columns from query";
      }
      columns = new Set(columnNames);
    } else {
      // For other datasources, extract from first row (requires LIMIT 1+)
      if (results.results.length === 0) {
        return "No rows returned";
      }
      columns = new Set(Object.keys(results.results[0]));
    }

    const missingColumns: string[] = [];
    for (const col of requiredColumns) {
      if (!columns.has(col)) {
        missingColumns.push(col);
      }
    }

    if (missingColumns.length > 0) {
      return `Missing required columns in response: ${missingColumns.join(
        ", ",
      )}`;
    }

    return undefined;
  } catch (e) {
    return e.message;
  }
}
