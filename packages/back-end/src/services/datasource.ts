import { AES, enc } from "crypto-js";
import { ENCRYPTION_KEY } from "../util/secrets";
import GoogleAnalytics from "../integrations/GoogleAnalytics";
import Athena from "../integrations/Athena";
import Presto from "../integrations/Presto";
import Databricks from "../integrations/Databricks";
import Redshift from "../integrations/Redshift";
import Snowflake from "../integrations/Snowflake";
import Postgres from "../integrations/Postgres";
import {
  InformationSchema,
  InformationSchemaInterface,
  SourceIntegrationInterface,
  TestQueryRow,
} from "../types/Integration";
import BigQuery from "../integrations/BigQuery";
import ClickHouse from "../integrations/ClickHouse";
import Mixpanel from "../integrations/Mixpanel";
import {
  DataSourceInterface,
  DataSourceParams,
  DataSourceSettings,
  DataSourceType,
} from "../../types/datasource";
import Mysql from "../integrations/Mysql";
import Mssql from "../integrations/Mssql";
import {
  createInformationSchema,
  updateInformationSchemaById,
} from "../models/InformationSchemaModel";
import { updateDataSource } from "../models/DataSourceModel";

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

export function getSourceIntegrationObject(datasource: DataSourceInterface) {
  const { type, params, settings } = datasource;

  const obj = getIntegrationObj(type, params, settings);

  // Sanity check, this should never happen
  if (!obj) {
    throw new Error("Unknown data source type: " + type);
  }

  obj.organization = datasource.organization;
  obj.datasource = datasource.id;

  return obj;
}

export async function fetchTableData(
  databaseName: string,
  tableSchema: string,
  tableName: string,
  datasource: DataSourceInterface
): Promise<{ tableData: null | unknown[]; refreshMS: number }> {
  const integration = getSourceIntegrationObject(datasource);

  if (!integration.getTableData) {
    throw new Error("Table data not supported for this data source");
  }

  const { tableData, refreshMS } = await integration.getTableData(
    databaseName,
    tableSchema,
    tableName
  );

  return { tableData, refreshMS };
}

export async function generateInformationSchema(
  datasource: DataSourceInterface
): Promise<InformationSchema[]> {
  const integration = getSourceIntegrationObject(datasource);

  if (!integration.getInformationSchema) {
    throw new Error("Information schema not supported for this data source");
  }

  return await integration.getInformationSchema();
}

export async function testDataSourceConnection(
  datasource: DataSourceInterface
) {
  const integration = getSourceIntegrationObject(datasource);
  await integration.testConnection();
}

export async function testQuery(
  datasource: DataSourceInterface,
  query: string
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

  const sql = integration.getTestQuery(query);
  try {
    const { results, duration } = await integration.runTestQuery(sql);
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

export async function initializeDatasourceInformationSchema(
  datasource: DataSourceInterface,
  organization: string
): Promise<string> {
  // Create an empty informationSchema
  const informationSchema = await createInformationSchema(
    [],
    organization,
    datasource.id
  );

  // Update the datasource with the informationSchemaId
  await updateDataSource(datasource.id, organization, {
    settings: {
      ...datasource.settings,
      informationSchemaId: informationSchema.id,
    },
  });

  // Update the empty informationSchema record with the actual informationSchema
  await updateInformationSchemaById(organization, informationSchema.id, {
    ...informationSchema,
    databases: await generateInformationSchema(datasource),
    status: "COMPLETE",
  });

  return informationSchema.id;
}

export async function updateDatasourceInformationSchema(
  datasource: DataSourceInterface,
  organization: string,
  informationSchema: InformationSchemaInterface
): Promise<string> {
  // Reset the informationSchema to remove any errors and change status to "PENDING"
  await updateInformationSchemaById(organization, informationSchema.id, {
    ...informationSchema,
    status: "PENDING",
    error: undefined,
  });

  // Update the empty informationSchema record with the actual informationSchema
  await updateInformationSchemaById(organization, informationSchema.id, {
    ...informationSchema,
    databases: await generateInformationSchema(datasource),
    status: "COMPLETE",
    error: undefined,
  });

  return informationSchema.id;
}
