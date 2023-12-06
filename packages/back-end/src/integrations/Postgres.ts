import { PostgresConnectionParams } from "../../types/integrations/postgres";
import { decryptDataSourceParams } from "../services/datasource";
import { runPostgresQuery } from "../services/postgres";
import { QueryResponse } from "../types/Integration";
import { FormatDialect } from "../util/sql";
import SqlIntegration from "./SqlIntegration";

export default class Postgres extends SqlIntegration {
  params!: PostgresConnectionParams;
  requiresDatabase = false;
  requiresSchema = false;
  setParams(encryptedParams: string) {
    this.params = decryptDataSourceParams<PostgresConnectionParams>(
      encryptedParams
    );
  }
  getFormatDialect(): FormatDialect {
    return "postgresql";
  }
  getSensitiveParamKeys(): string[] {
    return ["password", "caCert", "clientCert", "clientKey"];
  }
  runQuery(sql: string): Promise<QueryResponse> {
    return runPostgresQuery(this.params, sql);
  }
  getSchema(): string {
    return this.params.defaultSchema || "";
  }
  dateDiff(startCol: string, endCol: string) {
    return `${endCol}::DATE - ${startCol}::DATE`;
  }
  ensureFloat(col: string): string {
    return `${col}::float`;
  }
  formatDate(col: string) {
    return `to_char(${col}, 'YYYY-MM-DD')`;
  }
  formatDateTimeString(col: string): string {
    return `to_char(${col}, 'YYYY-MM-DD HH24:MI:SS.MS')`;
  }
  getInformationSchemaWhereClause(): string {
    return "table_schema NOT IN ('pg_catalog', 'information_schema', 'pg_toast')";
  }

  unnest(
    metrics: {
      id: string;
      name: string;
      hasDenominator: boolean;
    }[]
  ) {
    function formatJSONObj(obj: Record<string, string>) {
      // TODO: On Redshift, CONCAT only works with 2 arguments so need to nest multiple CONCAT calls
      return `CONCAT('{',${Object.entries(obj)
        .map(([k, v]) => `'"${k}":', ${v}`)
        .join(",")},'}')::json`;
    }

    const numeratorColumns = ["numerator_sum", "numerator_sum_squares"];
    const denominatorColumns = ["denominator_sum", "denominator_sum_squares"];

    return {
      // JSON encode all metrics into a single column
      // Unnest it to get one row per metric
      unnest: `unnest(ARRAY[
        ${metrics
          .map((m) => {
            const obj: Record<string, string> = {
              metric: JSON.stringify(m.id),
            };
            numeratorColumns.forEach((c) => {
              obj[c] = `${m.id}_${c}`;
            });
            denominatorColumns.forEach((c) => {
              obj[c] = m.hasDenominator ? `${m.id}_${c}` : "0";
            });

            return `-- ${m.name}${m.hasDenominator ? " (ratio)" : ""}
            ${formatJSONObj(obj)}`;
          })
          .join(",\n")}
        ]) as data`,

      // Extract the JSON object back into columns
      columns: ["metric", ...numeratorColumns, ...denominatorColumns].map(
        (c) => `data -> '${c}' as ${c}`
      ),
    };
  }
}
