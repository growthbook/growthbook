import { DataSourceType } from "aws-sdk/clients/appsync";
import { DatabricksConnectionParams } from "../../types/integrations/databricks";
import { runDatabricksQuery } from "../services/databricks";
import { decryptDataSourceParams } from "../services/datasource";
import { InformationSchema } from "../types/Integration";
import { FormatDialect } from "../util/sql";
import SqlIntegration from "./SqlIntegration";

export default class Databricks extends SqlIntegration {
  params!: DatabricksConnectionParams;
  setParams(encryptedParams: string) {
    this.params = decryptDataSourceParams<DatabricksConnectionParams>(
      encryptedParams
    );
  }
  getFormatDialect(): FormatDialect {
    // sql-formatter doesn't support databricks explicitly yet, so using their generic formatter instead
    return "sql";
  }
  getSensitiveParamKeys(): string[] {
    const sensitiveKeys: (keyof DatabricksConnectionParams)[] = ["token"];
    return sensitiveKeys;
  }
  runQuery(sql: string) {
    return runDatabricksQuery(this.params, sql);
  }
  toTimestamp(date: Date) {
    return `TIMESTAMP'${date.toISOString()}'`;
  }
  addTime(
    col: string,
    unit: "hour" | "minute",
    sign: "+" | "-",
    amount: number
  ): string {
    return `timestampadd(${unit},${sign === "-" ? "-" : ""}${amount},${col})`;
  }
  formatDate(col: string) {
    return `date_format(${col}, 'y-MM-dd')`;
  }
  castToString(col: string): string {
    return `cast(${col} as string)`;
  }
  ensureFloat(col: string): string {
    return `cast(${col} as double)`;
  }
  async getInformationSchema(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    dataSourceType: DataSourceType
  ): Promise<InformationSchema[] | null> {
    return null;
  }
}
