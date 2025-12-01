import { FormatDialect } from "shared/src/types";
import { formatAsync } from "back-end/src/util/sql";
import { formatInformationSchema } from "back-end/src/util/informationSchemas";
import { PostgresConnectionParams } from "back-end/types/integrations/postgres";
import { decryptDataSourceParams } from "back-end/src/services/datasource";
import { runPostgresQuery } from "back-end/src/services/postgres";
import {
  InformationSchema,
  QueryResponse,
  RawInformationSchema,
} from "back-end/src/types/Integration";
import SqlIntegration from "./SqlIntegration";

export default class Vertica extends SqlIntegration {
  params!: PostgresConnectionParams;
  requiresDatabase = true;
  requiresSchema = false;
  setParams(encryptedParams: string) {
    this.params =
      decryptDataSourceParams<PostgresConnectionParams>(encryptedParams);
  }
  getFormatDialect(): FormatDialect {
    return "postgresql";
  }
  getSensitiveParamKeys(): string[] {
    return ["password", "caCert", "clientCert", "clientKey"];
  }
  runQuery(sql: string): Promise<QueryResponse> {
    return runPostgresQuery(this.params, sql);
  }
  getSchema(): string {
    return this.params.defaultSchema || "";
  }
  dateDiff(startCol: string, endCol: string) {
    return `${endCol}::DATE - ${startCol}::DATE`;
  }
  ensureFloat(col: string): string {
    return `${col}::float`;
  }
  formatDate(col: string) {
    return `to_char(${col}, 'YYYY-MM-DD')`;
  }
  formatDateTimeString(col: string): string {
    return `to_char(${col}, 'YYYY-MM-DD HH24:MI:SS.MS')`;
  }
  getDefaultDatabase(): string {
    return this.params.database;
  }
  extractJSONField(jsonCol: string, path: string, isNumeric: boolean): string {
    const raw = `MAPLOOKUP(MapJSONExtractor(${jsonCol}), '${path}')`;
    return isNumeric ? this.ensureFloat(raw) : raw;
  }

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

    const results = await this.runQuery(
      await formatAsync(sql, this.getFormatDialect()),
    );

    if (!results.rows.length) {
      throw new Error(`No tables found.`);
    }

    return formatInformationSchema(results.rows as RawInformationSchema[]);
  }
  // may be able to optimize with using a string of multiple quantiles
  approxQuantile(value: string, quantile: string | number): string {
    return `APPROXIMATE_PERCENTILE(${value} USING PARAMETERS percentiles='${quantile}')`;
  }
}
