import {
  isTestableDataSourceType,
  testableDataSourceTypes,
  testDataSourceConnectionBodySchema,
} from "shared/validators";
import { dataSourceTypes } from "../../src/util/datasource-params";

describe("isTestableDataSourceType", () => {
  it("accepts every type that has user-entered credentials", () => {
    for (const type of testableDataSourceTypes) {
      expect(isTestableDataSourceType(type)).toBe(true);
    }
  });

  it("rejects types without credentials to test", () => {
    expect(isTestableDataSourceType("growthbook_clickhouse")).toBe(false);
    expect(isTestableDataSourceType("google_analytics")).toBe(false);
  });

  it("rejects unknown, empty, and missing values", () => {
    expect(isTestableDataSourceType("not-a-warehouse")).toBe(false);
    expect(isTestableDataSourceType("")).toBe(false);
    expect(isTestableDataSourceType(undefined)).toBe(false);
    expect(isTestableDataSourceType(null)).toBe(false);
  });

  it("covers every DataSourceType except the omitted ones", () => {
    const omitted = dataSourceTypes.filter(
      (type) => !isTestableDataSourceType(type),
    );
    expect(omitted.sort()).toEqual([
      "google_analytics",
      "growthbook_clickhouse",
    ]);
  });

  it("agrees with the request body schema", () => {
    for (const type of dataSourceTypes) {
      const result = testDataSourceConnectionBodySchema.safeParse({
        type,
        params: {},
      });
      expect(result.success).toBe(isTestableDataSourceType(type));
    }
  });
});
