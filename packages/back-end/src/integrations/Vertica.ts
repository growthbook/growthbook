import { SqlDialect } from "shared/types/sql";
import { format } from "shared/sql";
import {
  InformationSchema,
  QueryResponse,
  RawInformationSchema,
} from "shared/types/integrations";
import { PostgresConnectionParams } from "shared/types/integrations/postgres";
import { formatInformationSchema } from "back-end/src/util/informationSchemas";
import { decryptDataSourceParams } from "back-end/src/services/datasource";
import { runPostgresQuery } from "back-end/src/services/postgres";
import SqlIntegration from "./SqlIntegration";
import { verticaDialect } from "./dialects/vertica";

export default class Vertica extends SqlIntegration {
  params!: PostgresConnectionParams;
  requiresDatabase = true;
  requiresSchema = false;
  setParams(encryptedParams: string) {
    this.params =
      decryptDataSourceParams<PostgresConnectionParams>(encryptedParams);
  }
  getSqlDialect(): SqlDialect {
    return {
      ...verticaDialect,
      defaultSchema: this.params.defaultSchema || "",
    };
  }
  getSensitiveParamKeys(): string[] {
    return ["password", "caCert", "clientCert", "clientKey"];
  }
  runQuery(sql: string): Promise<QueryResponse> {
    return runPostgresQuery(this.params, sql);
  }
  getDefaultDatabase(): string {
    return this.params.database;
  }

  getInformationSchemaTable(schema?: string, database?: string): string {
    return this.generateTablePath("v_catalog.columns", schema, database);
  }
  getInformationSchemaWhereClause(): string {
    return "table_schema NOT IN ('v_catalog', 'v_monitor', 'v_license') AND NOT is_system_table";
  }
  async getInformationSchema(): Promise<InformationSchema[]> {
    const sql = `
  SELECT 
    table_name as table_name,
    '${this.getDefaultDatabase()}' as table_catalog,
    table_schema as table_schema,
    count(column_name) as column_count 
  FROM
    ${this.getInformationSchemaTable()}
    WHERE ${this.getInformationSchemaWhereClause()}
    GROUP BY table_name, table_schema, '${this.getDefaultDatabase()}'`;

    const results = await this.runQuery(
      format(sql, this.getSqlDialect().formatDialect),
    );

    if (!results.rows.length) {
      throw new Error(`No tables found.`);
    }

    return formatInformationSchema(results.rows as RawInformationSchema[]);
  }
}
