import { snowflakeCreateTableOptions } from "shared/enterprise";
import { SqlDialect } from "shared/types/sql";
import { QueryResponse, ExternalIdCallback } from "shared/types/integrations";
import { SnowflakeConnectionParams } from "shared/types/integrations/snowflake";
import { QueryMetadata } from "shared/types/query";
import { decryptDataSourceParams } from "back-end/src/services/datasource";
import { runSnowflakeQuery } from "back-end/src/services/snowflake";
import SqlIntegration from "./SqlIntegration";
import { snowflakeDialect } from "./dialects/snowflake";

export default class Snowflake extends SqlIntegration {
  params!: SnowflakeConnectionParams;
  requiresSchema = false;
  setParams(encryptedParams: string) {
    this.params =
      decryptDataSourceParams<SnowflakeConnectionParams>(encryptedParams);
  }
  getSqlDialect(): SqlDialect {
    return snowflakeDialect;
  }
  isWritingTablesSupported(): boolean {
    return true;
  }
  createUnitsTableOptions() {
    if (!this.datasource.settings.pipelineSettings) {
      throw new Error("Pipeline settings are required to create a units table");
    }
    return snowflakeCreateTableOptions(
      this.datasource.settings.pipelineSettings,
    );
  }
  getSensitiveParamKeys(): string[] {
    return ["password", "privateKey", "privateKeyPassword"];
  }
  runQuery(
    sql: string,
    setExternalId?: ExternalIdCallback,
    queryMetadata?: QueryMetadata,
  ): Promise<QueryResponse> {
    return runSnowflakeQuery(this.params, sql, setExternalId, queryMetadata);
  }
  supportsLimitZeroColumnValidation(): boolean {
    return true;
  }
  getInformationSchemaWhereClause(): string {
    return "table_schema NOT IN ('INFORMATION_SCHEMA')";
  }
  getDefaultDatabase() {
    return this.params.database || "";
  }
}
