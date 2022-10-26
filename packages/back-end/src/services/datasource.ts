import { AES, enc } from "crypto-js";
import { ENCRYPTION_KEY } from "../util/secrets";
import GoogleAnalytics from "../integrations/GoogleAnalytics";
import Athena from "../integrations/Athena";
import Presto from "../integrations/Presto";
import Redshift from "../integrations/Redshift";
import Snowflake from "../integrations/Snowflake";
import Postgres from "../integrations/Postgres";
import {
  SourceIntegrationInterface,
  TestQueryResult,
} from "../types/Integration";
import BigQuery from "../integrations/BigQuery";
import ClickHouse from "../integrations/ClickHouse";
import Mixpanel from "../integrations/Mixpanel";
import { DataSourceInterface, DataSourceParams } from "../../types/datasource";
import Mysql from "../integrations/Mysql";
import Mssql from "../integrations/Mssql";

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
  } else if (type === "mssql") {
    obj = new Mssql(params, settings);
  } else if (type === "bigquery") {
    obj = new BigQuery(params, settings);
  } else if (type === "clickhouse") {
    obj = new ClickHouse(params, settings);
  } else if (type === "mixpanel") {
    obj = new Mixpanel(params, settings ?? {});
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

export async function testQuery(
  datasource: DataSourceInterface,
  sql: string,
  minExperimentLength: number,
  startDate?: Date,
  endDate?: Date,
  experimentId?: string
  // eslint-disable-next-line
): Promise<TestQueryResult> {
  const integration = getSourceIntegrationObject(datasource);

  // The Mixpanel integration does not support test queries
  if (!integration.testQuery) {
    throw new Error("Unable to test query.");
  }
  return await integration.testQuery(
    sql,
    minExperimentLength,
    startDate,
    endDate,
    experimentId
  );
}

export function getSelectQueryColumns(sql: string): string[] {
  const formattedQuery = sql.toLowerCase().replace(/(\r\n|\n|\r)/gm, "");
  const selectStatement = formattedQuery.split("select");
  const rawColumns = selectStatement[1].split("from");
  const columns = rawColumns[0].split(",");

  const formattedColumns = columns.map((column) => {
    const containsAs = column.search(/as/i);

    if (containsAs !== -1) {
      const columnArr = column.split("as");
      return columnArr[1].trim();
    } else {
      return column.trim();
    }
  });

  return formattedColumns;
}
