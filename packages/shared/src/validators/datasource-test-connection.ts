import { z } from "zod";
import type { DataSourceType } from "shared/types/datasource";

// Managed Warehouse credentials are internal, and Google Analytics connects
// through OAuth, so neither has user-entered credentials to test.
export const testableDataSourceTypes = [
  "redshift",
  "athena",
  "snowflake",
  "postgres",
  "mysql",
  "mssql",
  "bigquery",
  "clickhouse",
  "presto",
  "databricks",
  "mixpanel",
  "vertica",
  "adobe_experience_platform_query_service",
] as const satisfies readonly DataSourceType[];

export type TestableDataSourceType = (typeof testableDataSourceTypes)[number];

export function isTestableDataSourceType(
  type: string | undefined | null,
): type is TestableDataSourceType {
  return (
    !!type && (testableDataSourceTypes as readonly string[]).includes(type)
  );
}

export const testDataSourceConnectionBodySchema = z.strictObject({
  type: z.enum(testableDataSourceTypes),
  params: z.record(z.string(), z.unknown()),
  projects: z.array(z.string()).optional(),
  // When set, blank secret fields fall back to this Data Source's saved values.
  datasourceId: z.string().optional(),
});

export type TestDataSourceConnectionBody = z.infer<
  typeof testDataSourceConnectionBodySchema
>;
