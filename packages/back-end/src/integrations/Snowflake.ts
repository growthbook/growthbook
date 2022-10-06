import { SnowflakeConnectionParams } from "../../types/integrations/snowflake";
import { decryptDataSourceParams } from "../services/datasource";
import { runSnowflakeQuery } from "../services/snowflake";
import SqlIntegration from "./SqlIntegration";

export default class Snowflake extends SqlIntegration {
  params: SnowflakeConnectionParams;
  setParams(encryptedParams: string) {
    this.params =
      decryptDataSourceParams<SnowflakeConnectionParams>(encryptedParams);
  }
  getSensitiveParamKeys(): string[] {
    return ["password"];
  }
  runQuery(sql: string) {
    return runSnowflakeQuery(this.params, sql);
  }
  formatDate(col: string): string {
    return `TO_VARCHAR(${col}, 'YYYY-MM-DD')`;
  }
  castToString(col: string): string {
    return `TO_VARCHAR(${col})`;
  }
}
