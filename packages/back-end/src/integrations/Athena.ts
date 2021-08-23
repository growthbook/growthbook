import { decryptDataSourceParams } from "../services/datasource";
import { runAthenaQuery } from "../services/athena";
import SqlIntegration from "./SqlIntegration";
import { AthenaConnectionParams } from "../../types/integrations/athena";

export default class Athena extends SqlIntegration {
  params: AthenaConnectionParams;
  setParams(encryptedParams: string) {
    this.params = decryptDataSourceParams<AthenaConnectionParams>(
      encryptedParams
    );
  }
  getNonSensitiveParams(): Partial<AthenaConnectionParams> {
    return {
      ...this.params,
      accessKeyId: undefined,
      secretAccessKey: undefined,
    };
  }
  toTimestamp(date: Date) {
    return `from_iso8601_timestamp('${date.toISOString()}')`;
  }
  runQuery(sql: string) {
    return runAthenaQuery(this.params, sql);
  }
  addHours(col: string, hours: number) {
    return `${col} + INTERVAL '${hours}' hour`;
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
