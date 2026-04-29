import { SqlDialect } from "shared/types/sql";
import { QueryResponse } from "shared/types/integrations";
import { PostgresConnectionParams } from "shared/types/integrations/postgres";
import { decryptDataSourceParams } from "back-end/src/services/datasource";
import { runPostgresQuery } from "back-end/src/services/postgres";
import SqlIntegration from "./SqlIntegration";
import { redshiftDialect } from "./dialects/redshift";

export default class Redshift extends SqlIntegration {
  params!: PostgresConnectionParams;
  setParams(encryptedParams: string) {
    this.params =
      decryptDataSourceParams<PostgresConnectionParams>(encryptedParams);
  }
  getSqlDialect(): SqlDialect {
    return {
      ...redshiftDialect,
      defaultSchema: this.params.defaultSchema || "",
    };
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
  getInformationSchemaTable(): string {
    return "SVV_COLUMNS";
  }
}
