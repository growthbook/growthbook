import { SqlDialect } from "shared/types/sql";
import { ExternalIdCallback, QueryResponse } from "shared/types/integrations";
import { AthenaConnectionParams } from "shared/types/integrations/athena";
import { decryptDataSourceParams } from "back-end/src/services/datasource";
import {
  cancelAthenaQuery,
  runAthenaQuery,
} from "back-end/src/services/athena";
import SqlIntegration from "./SqlIntegration";
import { athenaDialect } from "./dialects/athena";

export default class Athena extends SqlIntegration {
  params!: AthenaConnectionParams;
  requiresSchema = false;
  setParams(encryptedParams: string) {
    this.params =
      decryptDataSourceParams<AthenaConnectionParams>(encryptedParams);
  }
  getSqlDialect(): SqlDialect {
    return athenaDialect;
  }
  getSensitiveParamKeys(): string[] {
    return ["accessKeyId", "secretAccessKey"];
  }
  runQuery(
    sql: string,
    setExternalId: ExternalIdCallback,
  ): Promise<QueryResponse> {
    return runAthenaQuery(this.params, sql, setExternalId);
  }
  async cancelQuery(externalId: string): Promise<void> {
    await cancelAthenaQuery(this.params, externalId);
  }
  getDefaultDatabase() {
    return this.params.catalog || "";
  }
}
