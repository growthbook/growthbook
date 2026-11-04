import { z } from "zod";
import type { DataSourceType } from "shared/types/datasource";
import { dataSourceTypes } from "../util/datasource-params";

// Managed Warehouse credentials are internal, and Google Analytics connects
// through OAuth, so neither has user-entered credentials to test. Every other
// DataSourceType is testable, including types added later.
const omittedFromConnectionTest = [
  "growthbook_clickhouse",
  "google_analytics",
] as const satisfies readonly DataSourceType[];

export type TestableDataSourceType = Exclude<
  DataSourceType,
  (typeof omittedFromConnectionTest)[number]
>;

const omittedFromConnectionTestSet = new Set<string>(omittedFromConnectionTest);

export const testableDataSourceTypes = dataSourceTypes.filter(
  (type): type is TestableDataSourceType =>
    !omittedFromConnectionTestSet.has(type),
) as [TestableDataSourceType, ...TestableDataSourceType[]];

const testableDataSourceTypeSet = new Set<string>(testableDataSourceTypes);

export function isTestableDataSourceType(
  type: string | undefined | null,
): type is TestableDataSourceType {
  return !!type && testableDataSourceTypeSet.has(type);
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
