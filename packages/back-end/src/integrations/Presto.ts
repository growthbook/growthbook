/// <reference types="../../typings/presto-client" />
import { decryptDataSourceParams } from "../services/datasource";
import SqlIntegration from "./SqlIntegration";
import { PrestoConnectionParams } from "../../types/integrations/presto";
import { Client } from "presto-client";

// eslint-disable-next-line
type Row = any;

export default class Presto extends SqlIntegration {
  params: PrestoConnectionParams;
  setParams(encryptedParams: string) {
    this.params = decryptDataSourceParams<PrestoConnectionParams>(
      encryptedParams
    );
  }
  getNonSensitiveParams(): Partial<PrestoConnectionParams> {
    return {
      ...this.params,
      password: undefined,
    };
  }
  toTimestamp(date: Date) {
    return `from_iso8601_timestamp('${date.toISOString()}')`;
  }
  runQuery(sql: string) {
    const client = new Client({
      host: this.params.host,
      port: this.params.port,
      user: "growthbook",
      source: "nodejs-client",
      basic_auth: {
        user: this.params.username,
        password: this.params.password,
      },
      schema: this.params.schema,
      catalog: this.params.catalog,
      checkInterval: 500,
    });

    return new Promise<Row[]>((resolve, reject) => {
      let cols: string[];
      const rows: Row[] = [];

      client.execute({
        query: sql,
        catalog: this.params.catalog,
        schema: this.params.schema,
        columns: (error, data) => {
          if (error) return;
          cols = data.map((d) => d.name);
        },
        error: (error) => {
          reject(error);
        },
        data: (error, data) => {
          if (error) return;

          data.forEach((d) => {
            const row: Row = {};
            d.forEach((v, i) => {
              row[cols[i]] = v;
            });
            rows.push(row);
          });
        },
        success: () => {
          resolve(rows);
        },
      });
    });
  }
  addDateInterval(col: string, days: number) {
    return `${col} + INTERVAL '${days}' day`;
  }
  subtractHalfHour(col: string) {
    return `${col} - INTERVAL '30' minute`;
  }
  regexMatch(col: string, regex: string) {
    return `regexp_like(${col}, '${regex}')`;
  }
  percentile(col: string, percentile: number) {
    return `approx_percentile(${col}, ${percentile})`;
  }
}
