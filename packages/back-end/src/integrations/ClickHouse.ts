import { decryptDataSourceParams } from "../services/datasource";
import { ClickHouse as ClickHouseClient } from "clickhouse";
import SqlIntegration from "./SqlIntegration";
import { ClickHouseConnectionParams } from "../../types/integrations/clickhouse";

export default class ClickHouse extends SqlIntegration {
  params: ClickHouseConnectionParams;
  setParams(encryptedParams: string) {
    this.params = decryptDataSourceParams<ClickHouseConnectionParams>(
      encryptedParams
    );
  }
  getNonSensitiveParams(): Partial<ClickHouseConnectionParams> {
    return {
      ...this.params,
      password: undefined,
    };
  }
  async runQuery(sql: string) {
    const client = new ClickHouseClient({
      url: this.params.url,
      port: this.params.port,
      basicAuth: this.params.username
        ? {
            username: this.params.username,
            password: this.params.password,
          }
        : null,
      format: "json",
      debug: false,
      raw: false,
      config: {
        database: this.params.database,
      },
    });

    return await client.query(sql).toPromise();
  }
  toTimestamp(date: Date) {
    return `toDateTime('${date
      .toISOString()
      .substr(0, 19)
      .replace("T", " ")}')`;
  }
  addDateInterval(col: string, days: number) {
    return `date_add(day, ${days}, ${col})`;
  }
  subtractHalfHour(col: string) {
    return `date_sub(hour, 30, ${col})`;
  }
  regexMatch(col: string, regex: string) {
    // Does the regex need to escape `\` here?
    return `match(${col}, "${regex}")`;
  }
  percentile(col: string, percentile: number) {
    return `quantile(${percentile})(${col})`;
  }
  dateTrunc(col: string) {
    return `date_trunc('day', ${col})`;
  }
  dateDiff(startCol: string, endCol: string) {
    return `date_diff('day', ${startCol}, ${endCol})`;
  }
}
