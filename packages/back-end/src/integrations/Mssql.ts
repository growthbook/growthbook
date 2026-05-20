import { parseIntWithDefault } from "shared/util";
import { SqlDialect } from "shared/types/sql";
import { QueryResponse } from "shared/types/integrations";
import { MssqlConnectionParams } from "shared/types/integrations/mssql";
import { decryptDataSourceParams } from "back-end/src/services/datasource";
import { findOrCreateConnection } from "back-end/src/util/mssqlPoolManager";
import SqlIntegration from "./SqlIntegration";
import { mssqlDialect } from "./dialects/mssql";

/** Default TCP port for SQL Server; used when stored params are missing or not parseable as an integer. */
const MSSQL_DEFAULT_TCP_PORT = 1433;

export default class Mssql extends SqlIntegration {
  params!: MssqlConnectionParams;
  requiresSchema = false;
  setParams(encryptedParams: string) {
    this.params =
      decryptDataSourceParams<MssqlConnectionParams>(encryptedParams);
  }
  getSqlDialect(): SqlDialect {
    return mssqlDialect;
  }
  getSensitiveParamKeys(): string[] {
    return ["password"];
  }
  async runQuery(sqlStr: string): Promise<QueryResponse> {
    const conn = await findOrCreateConnection(this.datasource.id, {
      server: this.params.server,
      port: parseIntWithDefault(this.params.port, MSSQL_DEFAULT_TCP_PORT),
      user: this.params.user,
      password: this.params.password,
      database: this.params.database,
      requestTimeout: (this.params.requestTimeout ?? 0) * 1000,
      options: this.params.options,
    });

    const results = await conn.request().query(sqlStr);
    return { rows: results.recordset };
  }

  // MS SQL Server doesn't support the LIMIT keyword, so we have to use the TOP or OFFSET and FETCH keywords instead.
  // (and OFFSET/FETCH only work when there is an ORDER BY clause)
  ensureMaxLimit(sql: string, limit: number): string {
    return `WITH __table AS (\n${sql}\n) SELECT TOP ${limit} * FROM __table`;
  }
  getDefaultDatabase() {
    return this.params.database;
  }
}
