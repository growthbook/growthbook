import { databricksCreateTableOptions } from "shared/enterprise";
import { SqlDialect } from "shared/types/sql";
import { QueryResponse } from "shared/types/integrations";
import { DatabricksConnectionParams } from "shared/types/integrations/databricks";
import { runDatabricksQuery } from "back-end/src/services/databricks";
import { decryptDataSourceParams } from "back-end/src/services/datasource";
import SqlIntegration from "./SqlIntegration";
import { databricksDialect } from "./dialects/databricks";

export default class Databricks extends SqlIntegration {
  params!: DatabricksConnectionParams;
  requiresDatabase = true;
  requiresSchema = false;
  setParams(encryptedParams: string) {
    const params =
      decryptDataSourceParams<DatabricksConnectionParams>(encryptedParams);
    // Legacy rows predate authType and are always PAT
    params.authType = params.authType ?? "pat";
    this.params = params;
  }
  getSqlDialect(): SqlDialect {
    return databricksDialect;
  }
  isWritingTablesSupported(): boolean {
    return true;
  }
  dropUnitsTable(): boolean {
    return true;
  }
  createUnitsTableOptions() {
    if (!this.datasource.settings.pipelineSettings) {
      throw new Error("Pipeline settings are required to create a units table");
    }
    return databricksCreateTableOptions(
      this.datasource.settings.pipelineSettings,
    );
  }
  getSensitiveParamKeys(): string[] {
    const sensitiveKeys: (keyof DatabricksConnectionParams)[] = [
      "token",
      "oauthClientSecret",
    ];
    return sensitiveKeys;
  }
  runQuery(sql: string): Promise<QueryResponse> {
    return runDatabricksQuery(this.params, sql);
  }
  getDefaultDatabase(): string {
    return this.params.catalog;
  }
}
