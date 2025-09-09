import { existsSync } from "fs";
import { FormatDialect } from "shared/src/types";
import { format } from "shared/sql";
import odbc from "odbc";
import { formatInformationSchema } from "back-end/src/util/informationSchemas";
import { ImpalaConnectionParams } from "back-end/types/integrations/impala";
import { decryptDataSourceParams } from "back-end/src/services/datasource";
import {
  InformationSchema,
  QueryResponse,
  RawInformationSchema,
} from "back-end/src/types/Integration";
import { IS_CLOUD } from "back-end/src/util/secrets";
import SqlIntegration from "./SqlIntegration";

const IMPALA_DRIVER_PATH =
  process.env.IMPALA_DRIVER_PATH || "/opt/impala-odbc-driver.so";

export default class Impala extends SqlIntegration {
  params!: ImpalaConnectionParams;
  requiresDatabase = true;
  requiresSchema = false;
  setParams(encryptedParams: string) {
    this.params =
      decryptDataSourceParams<ImpalaConnectionParams>(encryptedParams);
  }
  getFormatDialect(): FormatDialect {
    return "sql";
  }
  getSensitiveParamKeys(): string[] {
    return ["connectionString"];
  }
  async runQuery(sql: string): Promise<QueryResponse> {
    if (IS_CLOUD) {
      throw new Error(
        "Impala connections are not supported in GrowthBook Cloud",
      );
    }

    // Make sure driver file exists
    if (!existsSync(IMPALA_DRIVER_PATH)) {
      throw new Error(
        `Impala ODBC Driver not found at ${IMPALA_DRIVER_PATH}. Please mount the driver file in this location or update the IMPALA_DRIVER_PATH env var to point to the correct path.`,
      );
    }

    const connectionString = `
      Driver=${IMPALA_DRIVER_PATH};
      Host=${this.params.host};
      Port=${this.params.port};
      AuthMech=${this.params.authMech};
      UID=${this.params.username};
      PWD=${this.params.password};
    `.replace(/\s+/g, ""); // clean whitespace

    const conn = await odbc.connect(connectionString);
    const result = await conn.query(sql);
    return {
      rows: result as QueryResponse["rows"],
    };
  }
  getSchema(): string {
    return this.params.defaultSchema || "";
  }
  dateDiff(startCol: string, endCol: string) {
    return `DATEDIFF(${endCol}, ${startCol})`;
  }
  ensureFloat(col: string): string {
    return `CAST(${col} AS float)`;
  }
  formatDate(col: string): string {
    return `FROM_TIMESTAMP(${col}, 'yyyy-MM-dd')`;
  }
  formatDateTimeString(col: string): string {
    return `FROM_TIMESTAMP(${col}, 'yyyy-MM-ddTHH:mm:ss.SSS')`;
  }
  getDefaultDatabase(): string {
    return "";
  }
  extractJSONField(jsonCol: string, path: string, isNumeric: boolean): string {
    const raw = `GET_JSON_OBJECT(${jsonCol}), '$.${path}')`;
    return isNumeric ? this.ensureFloat(raw) : raw;
  }

  // TODO: Switch this to use `SHOW`/`DESCRIBE` queries since Impala doesn't support information schema
  getInformationSchemaTable(schema?: string, database?: string): string {
    return this.generateTablePath("v_catalog.columns", schema, database);
  }
  getInformationSchemaWhereClause(): string {
    return "table_schema NOT IN ('v_catalog', 'v_monitor', 'v_license') AND NOT is_system_table";
  }
  async getInformationSchema(): Promise<InformationSchema[]> {
    const sql = `
  SELECT 
    table_name as table_name,
    '${this.getDefaultDatabase()}' as table_catalog,
    table_schema as table_schema,
    count(column_name) as column_count 
  FROM
    ${this.getInformationSchemaTable()}
    WHERE ${this.getInformationSchemaWhereClause()}
    GROUP BY table_name, table_schema, '${this.getDefaultDatabase()}'`;

    const results = await this.runQuery(format(sql, this.getFormatDialect()));

    if (!results.rows.length) {
      throw new Error(`No tables found.`);
    }

    return formatInformationSchema(results.rows as RawInformationSchema[]);
  }

  approxQuantile(value: string, quantile: string | number): string {
    if (quantile !== 0.5) {
      return `APPX_MEDIAN(${value})`;
    }
    // TODO: Switch this to use a 2-step window function for anything other than median since Impala doesn't support arbitrary quantile levels
    throw new Error("Impala only supports median quantiles");
  }

  hasQuantileTesting(): boolean {
    return false;
  }
  hasEfficientPercentile(): boolean {
    return false;
  }
}
