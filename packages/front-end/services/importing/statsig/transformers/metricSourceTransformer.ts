import { CreateFactTableProps } from "back-end/types/fact-table";
import { StatsigMetricSource } from "@/services/importing/statsig/types";

/**
 * Transform Statsig metric source to GrowthBook fact table
 */
export async function transformStatsigMetricSourceToFactTable(
  metricSource: StatsigMetricSource,
  project: string,
  datasource: string,
): Promise<CreateFactTableProps> {
  if (!datasource) {
    throw new Error("Datasource is required to create fact tables");
  }

  // TODO: ensure userIdTypes exists in the data source

  let sql = metricSource.sql || "";

  if (metricSource.sourceType === "table") {
    if (!metricSource.tableName) {
      throw new Error("Table name is required for table-based metric sources");
    }

    // TODO: use datasource-specific table name quoting (right now assuming BigQuery)
    sql = `SELECT 
  ${metricSource.timestampColumn || "timestamp"} as timestamp
  ${(metricSource.idTypeMapping || []).map((mapping) => `, ${mapping.column}`).join("\n  ")}
  ${(metricSource.customFieldMapping || []).map((mapping) => `, (${mapping.formula}) AS ${mapping.key}`).join("\n  ")}
FROM \`${metricSource.tableName}\``;

    // TODO: use datePartitionColumn to add WHERE clause for optimization
  } else {
    if (!sql) {
      throw new Error("SQL is required for query-based metric sources");
    }

    const additionalColumnsToSelect: string[] = [];

    // Custom timestamp column name needs an alias
    if (
      metricSource.timestampColumn &&
      metricSource.timestampColumn !== "timestamp"
    ) {
      additionalColumnsToSelect.push(
        `${metricSource.timestampColumn} AS timestamp`,
      );
    }

    // Materialize all computed fields
    if (metricSource.customFieldMapping) {
      metricSource.customFieldMapping.forEach((mapping) => {
        additionalColumnsToSelect.push(
          `(${mapping.formula}) AS ${mapping.key}`,
        );
      });
    }

    if (additionalColumnsToSelect.length > 0) {
      // Wrap in a subquery if we need to select additional columns
      sql = `SELECT *, ${additionalColumnsToSelect.join(", ")}\nFROM (\n${sql}\n) AS subquery`;
    }

    // Replace statsig macros with GrowthBook SQL Template Variables
    sql = sql
      .replace(
        /[`]?\{\s*statsig_start_date\s*\}[`]?/g,
        `'{{date startDateISO "yyyy-MM-dd"}}'`,
      )
      .replace(
        /\{\s*statsig_start_date_int\s*\}/g,
        `{{date startDateISO "yyyyMMdd"}}`,
      )
      .replace(
        /[`]?\{\s*statsig_end_date\s*\}[`]?/g,
        `'{{date endDateISO "yyyy-MM-dd"}}'`,
      )
      .replace(
        /\{\s*statsig_end_date_int\s*\}/g,
        `{{date endDateISO "yyyyMMdd"}}`,
      );
  }

  return {
    name: metricSource.name,
    description: metricSource.description || "",
    datasource,
    sql,
    columns: [],
    tags: metricSource.tags || [],
    owner: metricSource.owner?.ownerName || "",
    eventName: "",
    projects: project ? [project] : [],
    userIdTypes: metricSource.idTypeMapping?.map((t) => t.column) || [],
    managedBy:
      metricSource.isVerified || metricSource.isReadOnly ? "admin" : "",
  };
}
