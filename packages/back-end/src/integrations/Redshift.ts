import { PostgresConnectionParams } from "../../types/integrations/postgres";
import { decryptDataSourceParams } from "../services/datasource";
import { runPostgresQuery } from "../services/postgres";
import SqlIntegration from "./SqlIntegration";

export default class Redshift extends SqlIntegration {
  params: PostgresConnectionParams;
  setParams(encryptedParams: string) {
    this.params = decryptDataSourceParams<PostgresConnectionParams>(
      encryptedParams
    );
  }
  getSensitiveParamKeys(): string[] {
    return ["password"];
  }
  runQuery(sql: string) {
    return runPostgresQuery(this.params, sql);
  }
  getSchema(): string {
    return this.params.defaultSchema || "";
  }
  percentile(col: string, percentile: number) {
    return `APPROXIMATE  PERCENTILE_DISC ( ${percentile} ) WITHIN GROUP (ORDER BY ${col})`;
  }
  avg(col: string) {
    return `AVG(${col}::float)`;
  }
}
