import { SqlDialect } from "shared/types/sql";
import { ExternalIdCallback, QueryResponse } from "shared/types/integrations";
import { AthenaConnectionParams } from "shared/types/integrations/athena";
import { decryptDataSourceParams } from "back-end/src/services/datasource";
import {
  cancelAthenaQuery,
  getAthenaQueryStatus,
  runAthenaQuery,
} from "back-end/src/services/athena";
import {
  CancelQueryOutcome,
  ExternalQueryStatus,
} from "back-end/src/types/Integration";
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
  runQuery(
    sql: string,
    setExternalId: ExternalIdCallback,
  ): Promise<QueryResponse> {
    return runAthenaQuery(this.params, sql, setExternalId);
  }
  async cancelQuery(externalId: string): Promise<CancelQueryOutcome> {
    await cancelAthenaQuery(this.params, externalId);
    return "requested";
  }
  getExternalQueryStatus(externalId: string): Promise<ExternalQueryStatus> {
    return getAthenaQueryStatus(this.params, externalId);
  }
  getDefaultDatabase() {
    return this.params.catalog || "";
  }
}
