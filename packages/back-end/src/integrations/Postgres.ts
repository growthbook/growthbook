import { PostgresConnectionParams } from "../../types/integrations/postgres";
import { decryptDataSourceParams } from "../services/datasource";
import { runPostgresQuery } from "../services/postgres";
import SqlIntegration from "./SqlIntegration";

export default class Postgres extends SqlIntegration {
  params: PostgresConnectionParams;
  setParams(encryptedParams: string) {
    this.params = decryptDataSourceParams<PostgresConnectionParams>(
      encryptedParams
    );
  }
  getNonSensitiveParams(): Partial<PostgresConnectionParams> {
    return {
      ...this.params,
      password: undefined,
    };
  }
  runQuery(sql: string) {
    return runPostgresQuery(this.params, sql);
  }
  getSchema(): string {
    return this.params.defaultSchema || "";
  }
  percentile(col: string, percentile: number) {
    return `PERCENTILE_DISC ( ${percentile} ) WITHIN GROUP (ORDER BY ${col})`;
  }
  dateDiff(startCol: string, endCol: string) {
    return `${endCol}::DATE - ${startCol}::DATE`;
  }
}
