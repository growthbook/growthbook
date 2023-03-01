import { DataSourceType } from "../../types/datasource";
import { PostgresConnectionParams } from "../../types/integrations/postgres";
import { decryptDataSourceParams } from "../services/datasource";
import { runPostgresQuery } from "../services/postgres";
import { InformationSchema, RawInformationSchema } from "../types/Integration";
import { formatInformationSchema } from "../util/integrations";
import { FormatDialect } from "../util/sql";
import SqlIntegration from "./SqlIntegration";

export default class Postgres extends SqlIntegration {
  params!: PostgresConnectionParams;
  setParams(encryptedParams: string) {
    this.params = decryptDataSourceParams<PostgresConnectionParams>(
      encryptedParams
    );
  }
  getFormatDialect(): FormatDialect {
    return "postgresql";
  }
  getSensitiveParamKeys(): string[] {
    return ["password", "caCert", "clientCert", "clientKey"];
  }
  runQuery(sql: string) {
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
  async getInformationSchema(
    dataSourceType: DataSourceType
  ): Promise<InformationSchema[]> {
    const sql = `SELECT
        table_name,
        column_name,
        data_type,
        table_catalog,
        table_schema
      FROM
        information_schema.columns
      WHERE
        table_schema
      NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
      ORDER BY table_name;`;

    const results = await this.runQuery(sql);

    return results.length
      ? formatInformationSchema(
          results as RawInformationSchema[],
          dataSourceType
        )
      : [];
  }
}
