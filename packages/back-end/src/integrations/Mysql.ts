import mysql, { RowDataPacket } from "mysql2/promise";
import { ConnectionOptions } from "mysql2";
import { SqlDialect } from "shared/types/sql";
import { QueryResponse } from "shared/types/integrations";
import { MysqlConnectionParams } from "shared/types/integrations/mysql";
import { decryptDataSourceParams } from "back-end/src/services/datasource";
import { getFactTableTypeFromMysqlTypeCode } from "back-end/src/util/warehouseColumnTypes";
import SqlIntegration from "./SqlIntegration";
import { mysqlDialect } from "./dialects/mysql";

export default class Mysql extends SqlIntegration {
  params!: MysqlConnectionParams;
  requiresDatabase = false;
  requiresSchema = false;
  setParams(encryptedParams: string) {
    this.params =
      decryptDataSourceParams<MysqlConnectionParams>(encryptedParams);
  }
  getSqlDialect(): SqlDialect {
    return mysqlDialect;
  }
  async runQuery(sql: string): Promise<QueryResponse> {
    const config: ConnectionOptions = {
      host: this.params.host,
      port: this.params.port,
      user: this.params.user,
      password: this.params.password,
      database: this.params.database,
    };
    if (this.params.ssl) {
      config["ssl"] = {
        ca: this.params.caCert,
        cert: this.params.clientCert,
        key: this.params.clientKey,
      };
    }
    const conn = await mysql.createConnection(config);

    const [rows, fields] = await conn.query(sql);
    conn.end();
    return {
      rows: rows as RowDataPacket[],
      // `fields` describes the query's output schema and comes back even when
      // no rows matched, so a LIMIT 0 query is enough to read it
      columns: fields?.map((field) => {
        const dataType =
          field.columnType === undefined
            ? undefined
            : getFactTableTypeFromMysqlTypeCode(
                field.columnType,
                field.characterSet,
              );
        return { name: field.name, ...(dataType && { dataType }) };
      }),
    };
  }
  hasQuantileTesting(): boolean {
    return false;
  }
  hasEfficientPercentile(): boolean {
    return false;
  }
  canGroupPercentileCappedMetrics(): boolean {
    return false;
  }
  getInformationSchemaWhereClause(): string {
    if (!this.params.database)
      throw new Error(
        `No database name provided in MySql connection. Please add a database by editing the connection settings.`,
      );
    return `table_schema IN ('${this.params.database}')`;
  }
}
