import { CreateFactTableProps } from "back-end/types/fact-table";
import { StatsigMetricSource } from "@/services/importing/statsig/types";

/**
 * Transform Statsig metric source to GrowthBook fact table
 */
export async function transformStatsigMetricSourceToFactTable(
  metricSource: StatsigMetricSource,
  apiCall: (
    path: string,
    options?: { method: string; body: string },
  ) => Promise<unknown>,
  project?: string,
  datasource?: string,
): Promise<CreateFactTableProps> {
  if (!datasource) {
    throw new Error("Datasource is required to create fact tables");
  }

  // TODO: ensure userIdTypes exists in the data source

  let sql = metricSource.sql || "";

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
  if (metricSource.columnFieldMapping) {
    metricSource.columnFieldMapping.forEach((mapping) => {
      additionalColumnsToSelect.push(`(${mapping.formula}) AS ${mapping.key}`);
    });
  }

  if (additionalColumnsToSelect.length > 0) {
    // Wrap in a subquery if we need to select additional columns
    sql = `SELECT *, ${additionalColumnsToSelect.join(", ")}\nFROM (\n${sql}\n) AS subquery`;
  }

  // TODO: use datePartitionColumn to add WHERE clause for optimization

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
