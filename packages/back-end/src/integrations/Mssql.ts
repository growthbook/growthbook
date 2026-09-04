import { parseIntWithDefault } from "shared/util";
import { SqlDialect } from "shared/types/sql";
import { IRecordSet } from "mssql";
import {
  QueryResponse,
  QueryResponseColumnData,
} from "shared/types/integrations";
import { MssqlConnectionParams } from "shared/types/integrations/mssql";
import { decryptDataSourceParams } from "back-end/src/services/datasource";
import { findOrCreateConnection } from "back-end/src/util/mssqlPoolManager";
import { getFactTableTypeFromMssqlDeclaration } from "back-end/src/util/warehouseColumnTypes";
import SqlIntegration from "./SqlIntegration";
import { mssqlDialect } from "./dialects/mssql";

/** Default TCP port for SQL Server; used when stored params are missing or not parseable as an integer. */
const MSSQL_DEFAULT_TCP_PORT = 1433;

/**
 * The mssql driver attaches a `declaration` (a lowercased T-SQL type name) to
 * each column's type factory, but doesn't declare it on `ISqlTypeFactory`, so
 * read it defensively.
 */
function getTypeDeclaration(type: unknown): string | undefined {
  if (type === null || (typeof type !== "object" && typeof type !== "function"))
    return undefined;
  const declaration = (type as { declaration?: unknown }).declaration;
  return typeof declaration === "string" ? declaration : undefined;
}

function getRecordsetColumns(
  recordset: IRecordSet<Record<string, unknown>> | undefined,
): QueryResponseColumnData[] | undefined {
  const columns = recordset?.columns;
  if (!columns) return undefined;

  return (
    Object.values(columns)
      // Keyed by name, so restore the SELECT order
      .sort((a, b) => a.index - b.index)
      .map((column) => {
        const declaration = getTypeDeclaration(column.type);
        const dataType = declaration
          ? getFactTableTypeFromMssqlDeclaration(declaration)
          : undefined;
        return { name: column.name, ...(dataType && { dataType }) };
      })
  );
}

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
    return {
      rows: results.recordset,
      // Column metadata arrives before any rows and is attached to the
      // recordset even when it's empty, so a TOP 0 query is enough to read the
      // query's output schema
      columns: getRecordsetColumns(results.recordset),
    };
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
