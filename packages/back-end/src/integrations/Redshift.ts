import { PostgresConnectionParams } from "back-end/types/integrations/postgres";
import { decryptDataSourceParams } from "back-end/src/services/datasource";
import { runPostgresQuery } from "back-end/src/services/postgres";
import { QueryResponse } from "back-end/src/types/Integration";
import { FormatDialect } from "back-end/src/util/sql";
import SqlIntegration from "./SqlIntegration";

export default class Redshift extends SqlIntegration {
  params!: PostgresConnectionParams;
  setParams(encryptedParams: string) {
    this.params = decryptDataSourceParams<PostgresConnectionParams>(
      encryptedParams
    );
  }
  getFormatDialect(): FormatDialect {
    return "redshift";
  }
  getSensitiveParamKeys(): string[] {
    return ["password", "caCert", "clientCert", "clientKey"];
  }
  hasEfficientPercentile(): boolean {
    return false;
  }
  runQuery(sql: string): Promise<QueryResponse> {
    return runPostgresQuery(this.params, sql);
  }
  getSchema(): string {
    return this.params.defaultSchema || "";
  }
  formatDate(col: string) {
    return `to_char(${col}, 'YYYY-MM-DD')`;
  }
  formatDateTimeString(col: string) {
    return `to_char(${col}, 'YYYY-MM-DD HH24:MI:SS.MS')`;
  }
  ensureFloat(col: string): string {
    return `${col}::float`;
  }
  approxQuantile(value: string, quantile: string | number): string {
    // approx behaves differently in redshift
    return `PERCENTILE_CONT(${quantile}) WITHIN GROUP (ORDER BY ${value})`;
  }
  getInformationSchemaTable(): string {
    return "SVV_COLUMNS";
  }
}
