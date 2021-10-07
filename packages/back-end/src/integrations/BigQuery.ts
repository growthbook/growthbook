import { decryptDataSourceParams } from "../services/datasource";
import * as bq from "@google-cloud/bigquery";
import SqlIntegration from "./SqlIntegration";
import { BigQueryConnectionParams } from "../../types/integrations/bigquery";

export default class BigQuery extends SqlIntegration {
  params: BigQueryConnectionParams;
  setParams(encryptedParams: string) {
    this.params = decryptDataSourceParams<BigQueryConnectionParams>(
      encryptedParams
    );
  }
  getSensitiveParamKeys(): string[] {
    return ["privateKey"];
  }
  async runQuery(sql: string) {
    const client = new bq.BigQuery({
      projectId: this.params.projectId,
      credentials: {
        client_email: this.params.clientEmail,
        private_key: this.params.privateKey,
      },
    });

    const [job] = await client.createQueryJob({
      query: sql,
      useLegacySql: false,
    });
    const [rows] = await job.getQueryResults();
    return rows;
  }
  toTimestamp(date: Date) {
    return `DATETIME "${date.toISOString().substr(0, 19).replace("T", " ")}"`;
  }
  addHours(col: string, hours: number) {
    return `DATETIME_ADD(${col}, INTERVAL ${hours} HOUR)`;
  }
  subtractHalfHour(col: string) {
    return `DATETIME_SUB(${col}, INTERVAL 30 MINUTE)`;
  }
  regexMatch(col: string, regex: string) {
    return `REGEXP_CONTAINS(${col}, r"${regex}")`;
  }
  percentile(col: string, percentile: number) {
    return `APPROX_QUANTILES(${col}, 100)[OFFSET(${Math.floor(
      percentile * 100
    )})]`;
  }
  convertDate(fromDB: bq.BigQueryDatetime) {
    return new Date(fromDB.value + "Z");
  }
  dateTrunc(col: string) {
    return `date_trunc(${col}, DAY)`;
  }
  dateDiff(startCol: string, endCol: string) {
    return `date_diff(${endCol}, ${startCol}, DAY)`;
  }
}
