import { SnowflakeConnectionParams } from "../../types/integrations/snowflake";
import { decryptDataSourceParams } from "../services/datasource";
import { getSnowflakeClient, runSnowflakeQuery } from "../services/snowflake";
import SqlIntegration from "./SqlIntegration";

export default class Snowflake extends SqlIntegration {
  params: SnowflakeConnectionParams;
  setParams(encryptedParams: string) {
    this.params = decryptDataSourceParams<SnowflakeConnectionParams>(
      encryptedParams
    );
  }
  getSensitiveParamKeys(): string[] {
    return ["password"];
  }
  async runQuery(sql: string) {
    const snowflake = await this.createPooledConnection(
      () => getSnowflakeClient(this.params),
      15
    );
    return runSnowflakeQuery(snowflake, sql);
  }
  percentile(col: string, percentile: number) {
    return `APPROX_PERCENTILE(${col}, ${percentile})`;
  }
  regexMatch(col: string, regex: string) {
    // Snowflake automatically adds `$` to the end of the regex
    // If specified, remove it. Otherwise, injext .* before the end to match intended behavior
    if (regex.substr(-1) === "$") {
      regex = regex.substr(0, regex.length - 1);
    } else {
      regex += ".*";
    }

    // Same with '^' at the beginning
    if (regex.substr(0, 1) === "^") {
      regex = regex.substr(1);
    } else {
      regex = ".*" + regex;
    }

    return `rlike(${col}, '${regex}')`;
  }
  formatDate(col: string): string {
    return `TO_VARCHAR(${col}, 'YYYY-MM-DD')`;
  }
  castToString(col: string): string {
    return `TO_VARCHAR(${col})`;
  }
}
