import { existsSync } from "fs";
import { FormatDialect } from "shared/src/types";
import odbc from "odbc";
import { ODBCConnectionParams } from "back-end/types/integrations/odbc";
import { decryptDataSourceParams } from "back-end/src/services/datasource";
import {
  InformationSchema,
  QueryResponse,
  Table,
} from "back-end/src/types/Integration";
import { IS_CLOUD } from "back-end/src/util/secrets";
import SqlIntegration from "./SqlIntegration";

let odbcFilesExist: boolean | null = null;

export default class ODBC extends SqlIntegration {
  params!: ODBCConnectionParams;
  requiresDatabase = false;
  requiresSchema = false;
  setParams(encryptedParams: string) {
    this.params =
      decryptDataSourceParams<ODBCConnectionParams>(encryptedParams);
  }
  getFormatDialect(): FormatDialect {
    return "sql";
  }
  getSensitiveParamKeys(): string[] {
    return [];
  }

  private checkOdbcFiles() {
    if (odbcFilesExist === null) {
      odbcFilesExist =
        existsSync("/etc/odbcinst.ini") && existsSync("/etc/odbc.ini");
    }
    return odbcFilesExist;
  }

  async runQuery(sql: string): Promise<QueryResponse> {
    // Sanity check. We will also hide this option from the UI.
    if (IS_CLOUD) {
      throw new Error(
        "Impala connections are not supported in GrowthBook Cloud",
      );
    }

    if (!this.checkOdbcFiles()) {
      throw new Error(
        "The files /etc/odbcinst.ini and /etc/odbc.ini are required. Please mount your ODBC driver and configuration files.",
      );
    }

    if (this.params.dsn.indexOf(";") !== -1) {
      throw new Error("DSN cannot contain semicolons");
    }

    const connectionString = `DSN=${this.params.dsn}`;

    const conn = await odbc.connect(connectionString);
    const result = await conn.query(sql);
    return {
      rows: result as QueryResponse["rows"],
    };
  }
  getSchema(): string {
    return "";
  }
  dateDiff(startCol: string, endCol: string) {
    switch (this.params.driver) {
      case "impala":
        return `DATEDIFF(${endCol}, ${startCol})`;
    }
  }
  ensureFloat(col: string): string {
    switch (this.params.driver) {
      case "impala":
        return `CAST(${col} AS DOUBLE)`;
    }
  }
  addTime(
    col: string,
    unit: "hour" | "minute",
    sign: "+" | "-",
    amount: number,
  ): string {
    switch (this.params.driver) {
      case "impala":
        if (sign === "+") {
          return `date_add(${col}, interval ${amount} ${unit})`;
        } else {
          return `date_sub(${col}, interval ${amount} ${unit})`;
        }
    }
  }
  dateTrunc(col: string): string {
    switch (this.params.driver) {
      case "impala":
        return `trunc(${col}, 'DD')`;
    }
  }

  castToString(col: string): string {
    switch (this.params.driver) {
      case "impala":
        return `CAST(${col} AS STRING)`;
    }
  }
  formatDate(col: string): string {
    switch (this.params.driver) {
      case "impala":
        return `FROM_TIMESTAMP(${col}, 'yyyy-MM-dd')`;
    }
  }
  formatDateTimeString(col: string): string {
    switch (this.params.driver) {
      case "impala":
        return `FROM_TIMESTAMP(${col}, 'yyyy-MM-ddTHH:mm:ss.SSS')`;
    }
  }
  extractJSONField(jsonCol: string, path: string, isNumeric: boolean): string {
    let raw: string;
    switch (this.params.driver) {
      case "impala":
        raw = `GET_JSON_OBJECT(${jsonCol}), '$.${path}')`;
    }

    return isNumeric ? this.ensureFloat(raw) : raw;
  }

  async getInformationSchema(): Promise<InformationSchema[]> {
    switch (this.params.driver) {
      case "impala":
        return (async () => {
          let queryCount = 0;
          const maxQueries = 20;

          const infoSchema: InformationSchema = {
            databaseName: "impala",
            schemas: [],
            dateCreated: new Date(),
            dateUpdated: new Date(),
          };

          const dbRes = await this.runQuery("SHOW DATABASES");
          const databases = dbRes.rows.map((r) => r.name as string);

          for (const dbName of databases) {
            if (queryCount >= maxQueries) break;

            const tablesRes = await this.runQuery(`SHOW TABLES IN ${dbName}`);
            queryCount++;
            const tableNames = tablesRes.rows.map(
              (r) => Object.values(r)[0] as string,
            );

            const tables: Table[] = [];
            for (const tableName of tableNames) {
              tables.push({
                tableName,
                id: `${dbName}.${tableName}`,
                // Getting the true count requires a separate query per table which is too expensive
                numOfColumns: 1,
                dateCreated: new Date(),
                dateUpdated: new Date(),
              });
            }

            infoSchema.schemas.push({
              schemaName: dbName,
              tables,
              dateCreated: new Date(),
              dateUpdated: new Date(),
            });
          }

          return [infoSchema];
        })();
    }
  }
  async getTableData(
    databaseName: string,
    tableSchema: string,
    tableName: string,
  ): Promise<{ tableData: null | unknown[] }> {
    switch (this.params.driver) {
      case "impala":
        return (async () => {
          // In Impala, schema == database. We'll ignore tableSchema or use it as alias.
          const qualifiedName = `${databaseName}.${tableName}`;
          const res = await this.runQuery(`DESCRIBE ${qualifiedName}`);

          const tableData: { column_name: string; data_type: string }[] =
            res.rows
              .filter((r) => r.name && r.type) // filter out headers, partition info, blanks
              .map((r) => ({
                column_name: r.name as string,
                data_type: r.type as string,
              }));

          return { tableData };
        })();
    }
  }

  percentileCapSelectClause(
    values: {
      valueCol: string;
      outputCol: string;
      percentile: number; // between 0 and 1
      ignoreZeros: boolean;
    }[],
    metricTable: string,
    where: string = "",
  ): string {
    switch (this.params.driver) {
      case "impala":
        return ((): string => {
          if (values.length > 1) {
            throw new Error(
              "Impala only supports one percentile capped metric at a time",
            );
          }

          const { valueCol, outputCol, percentile, ignoreZeros } = values[0];

          let whereClause = where;
          if (ignoreZeros) {
            whereClause = whereClause
              ? `(${whereClause}) AND ${valueCol} != 0`
              : `WHERE ${valueCol} != 0`;
          }

          // Special-case: median
          if (percentile === 0.5) {
            return `
              SELECT APPX_MEDIAN(${valueCol}) AS ${outputCol}
              FROM ${metricTable}
              ${whereClause}
            `;
          }

          // General percentile (approximate via PERCENT_RANK trick)
          return `
            SELECT DISTINCT FIRST_VALUE(${valueCol}) OVER (
              ORDER BY CASE WHEN p >= ${percentile} THEN p END ASC
            ) AS ${outputCol}
            FROM (
              SELECT
                ${valueCol},
                PERCENT_RANK() OVER (ORDER BY ${valueCol}) AS p
              FROM ${metricTable}
              ${whereClause}
            ) t
          `;
        })();
    }
  }

  hasQuantileTesting(): boolean {
    return false;
  }
  hasEfficientPercentile(): boolean {
    return false;
  }
}
