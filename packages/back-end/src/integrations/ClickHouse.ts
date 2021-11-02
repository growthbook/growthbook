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

    if (this.params.user) {
      this.params.username = this.params.user;
      delete this.params.user;
    }
    if (this.params.host) {
      this.params.url = this.params.host;
      delete this.params.host;
    }
  }
  getSensitiveParamKeys(): string[] {
    return ["password"];
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
      reqParams: {
        headers: {
          "x-clickhouse-format": "JSON",
        },
      },
    });
    return Array.from(await client.query(sql).toPromise());
  }
  toTimestamp(date: Date) {
    return `toDateTime('${date
      .toISOString()
      .substr(0, 19)
      .replace("T", " ")}')`;
  }
  addHours(col: string, hours: number) {
    return `dateAdd(hour, ${hours}, ${col})`;
  }
  subtractHalfHour(col: string) {
    return `dateSub(minute, 30, ${col})`;
  }
  regexMatch(col: string, regex: string) {
    return `match(${col}, '${regex.replace(/\\/g, "\\\\")}')`;
  }
  percentile(col: string, percentile: number) {
    return `quantile(${percentile})(${col})`;
  }
  dateTrunc(col: string) {
    return `dateTrunc('day', ${col})`;
  }
  dateDiff(startCol: string, endCol: string) {
    return `dateDiff('day', ${startCol}, ${endCol})`;
  }
  stddev(col: string) {
    return `stddevSamp(${col})`;
  }
  formatDate(col: string): string {
    return `formatDateTime(${col}, '%F')`;
  }
  ifElse(condition: string, ifTrue: string, ifFalse: string) {
    return `if(${condition}, ${ifTrue}, ${ifFalse})`;
  }
}
