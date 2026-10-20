import { SqlDialect } from "shared/types/sql";
import { QueryResponse } from "shared/types/integrations";
import { PostgresConnectionParams } from "shared/types/integrations/postgres";
import { decryptDataSourceParams } from "back-end/src/services/datasource";
import { runPostgresQuery } from "back-end/src/services/postgres";
import { getFactTableTypeFromPostgresOid } from "back-end/src/util/warehouseColumnTypes";
import SqlIntegration from "./SqlIntegration";

export default class Postgres extends SqlIntegration {
  params!: PostgresConnectionParams;
  requiresDatabase = false;
  requiresSchema = false;
  setParams(encryptedParams: string) {
    this.params =
      decryptDataSourceParams<PostgresConnectionParams>(encryptedParams);
  }
  getSqlDialect(): SqlDialect {
    return {
      ...super.getSqlDialect(),
      defaultSchema: this.params.defaultSchema || "",
    };
  }
  runQuery(sql: string): Promise<QueryResponse> {
    return runPostgresQuery(
      this.params,
      sql,
      [],
      getFactTableTypeFromPostgresOid,
    );
  }
  getInformationSchemaWhereClause(): string {
    return "table_schema NOT IN ('pg_catalog', 'information_schema', 'pg_toast')";
  }
}
