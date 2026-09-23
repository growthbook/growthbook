import { format } from "shared/sql";
import { SqlDialect } from "shared/types/sql";
import { QueryResponse } from "shared/types/integrations";
import { PostgresConnectionParams } from "shared/types/integrations/postgres";
import { decryptDataSourceParams } from "back-end/src/services/datasource";
import { runPostgresQuery } from "back-end/src/services/postgres";
import { getFactTableTypeFromPostgresOid } from "back-end/src/util/warehouseColumnTypes";
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
  hasEfficientPercentile(): boolean {
    return false;
  }
  isWritingTablesSupported(): boolean {
    return true;
  }
  getDefaultDatabase() {
    return this.params.database || "";
  }
  // Redshift has no CREATE OR REPLACE TABLE. Without ephemeral mode this only
  // runs for pipeline validation, whose table name is random.
  getExperimentUnitsTableQueryFromCte(
    unitsTableFullName: string,
    cteSql: string,
  ): string {
    return format(
      `
      CREATE TABLE ${unitsTableFullName}
      ${this.createUnitsTableOptions()}
      AS (
        WITH
        ${cteSql}
        SELECT * FROM __experimentUnits
      );
    `,
      this.getSqlDialect().formatDialect,
    );
  }
  runQuery(sql: string): Promise<QueryResponse> {
    return runPostgresQuery(
      this.params,
      sql,
      [],
      getFactTableTypeFromPostgresOid,
    );
  }
  getInformationSchemaTable(): string {
    return "SVV_COLUMNS";
  }
}
