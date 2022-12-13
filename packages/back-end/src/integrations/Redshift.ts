import { PostgresConnectionParams } from "../../types/integrations/postgres";
import { decryptDataSourceParams } from "../services/datasource";
import { runPostgresQuery } from "../services/postgres";
import { FormatDialect } from "../util/sql";
import SqlIntegration from "./SqlIntegration";

export default class Redshift extends SqlIntegration {
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
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
  runQuery(sql: string) {
    return runPostgresQuery(this.params, sql);
  }
  getSchema(): string {
    return this.params.defaultSchema || "";
  }
  covariance(y: string, x: string): string {
    return `(SUM(${x}*${y})-SUM(${x})*SUM(${y})/COUNT(*))/(COUNT(*)-1)`;
  }
  formatDate(col: string) {
    return `to_char(${col}, 'YYYY-MM-DD')`;
  }
  ensureFloat(col: string): string {
    return `${col}::float`;
  }
}
