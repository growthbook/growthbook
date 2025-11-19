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

  // We don't support custom timestamp column names right now
  if (
    metricSource.timestampColumn &&
    metricSource.timestampColumn !== "timestamp"
  ) {
    additionalColumnsToSelect.push(
      `${metricSource.timestampColumn} AS timestamp`,
    );
  }
  // We don't support computed fields right now
  if (metricSource.columnFieldMapping) {
    metricSource.columnFieldMapping.forEach((mapping) => {
      additionalColumnsToSelect.push(`(${mapping.formula}) AS ${mapping.key}`);
    });
  }

  if (additionalColumnsToSelect.length > 0) {
    // Wrap in a subquery so we can alias the timestamp column to "timestamp"
    sql = `SELECT *, ${additionalColumnsToSelect.join(", ")}\nFROM (\n${sql}\n) AS subquery`;
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
