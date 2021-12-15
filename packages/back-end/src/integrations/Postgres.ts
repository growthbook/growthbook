import { PostgresConnectionParams } from "../../types/integrations/postgres";
import { decryptDataSourceParams } from "../services/datasource";
import { getPostgresClient, runPostgresQuery } from "../services/postgres";
import SqlIntegration from "./SqlIntegration";

export default class Postgres extends SqlIntegration {
  params: PostgresConnectionParams;
  setParams(encryptedParams: string) {
    this.params = decryptDataSourceParams<PostgresConnectionParams>(
      encryptedParams
    );
  }
  getSensitiveParamKeys(): string[] {
    return ["password"];
  }
  async runQuery(sql: string) {
    const { client } = await this.createPooledConnection(
      () => getPostgresClient(this.params),
      15,
      ({ destroy }) => destroy()
    );
    return runPostgresQuery(client, sql);
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
  avg(col: string) {
    return `AVG(${col}::float)`;
  }
  formatDate(col: string) {
    return `to_char(${col}, 'YYYY-MM-DD')`;
  }
}
