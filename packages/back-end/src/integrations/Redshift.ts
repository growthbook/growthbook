import { decryptDataSourceParams } from "@back-end/src/services/datasource";
import { runPostgresQuery } from "@back-end/src/services/postgres";
import { FormatDialect } from "@back-end/src/util/sql";
import { PostgresConnectionParams } from "@back-end/types/integrations/postgres";
import { QueryResponse } from "@back-end/src/types/Integration";
import SqlIntegration from "./SqlIntegration";

export default class Redshift extends SqlIntegration {
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-expect-error
  params: PostgresConnectionParams;
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
  getInformationSchemaTable(): string {
    return "SVV_COLUMNS";
  }
}
