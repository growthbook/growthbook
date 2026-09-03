import {
  getProductAnalyticsColumnValuesBodySchema,
  getProductAnalyticsColumnsQuerySchema,
  searchProductAnalyticsResourcesQuerySchema,
} from "back-end/src/api/specs/analytics-exploration.spec";

describe("Product Analytics API schemas", () => {
  it("parses bounded search pagination", () => {
    expect(
      searchProductAnalyticsResourcesQuerySchema.parse({
        limit: "20",
        skip: "10",
      }),
    ).toEqual({
      query: "",
      limit: 20,
      skip: 10,
    });
    expect(() =>
      searchProductAnalyticsResourcesQuerySchema.parse({ limit: "21" }),
    ).toThrow();
    expect(() =>
      searchProductAnalyticsResourcesQuerySchema.parse({
        query: "x".repeat(201),
      }),
    ).toThrow();
  });

  it("requires exactly one source selector", () => {
    expect(
      getProductAnalyticsColumnsQuerySchema.parse({
        source: "metric",
        metricIds: "fact__one,fact__two",
      }),
    ).toMatchObject({ metricIds: ["fact__one", "fact__two"] });
    expect(() =>
      getProductAnalyticsColumnsQuerySchema.parse({
        source: "metric",
        metricIds: "fact__one",
        factTableId: "ft_1",
      }),
    ).toThrow();
  });

  it("bounds column-value warehouse queries", () => {
    expect(() =>
      getProductAnalyticsColumnValuesBodySchema.parse({
        source: "fact_table",
        factTableId: "ft_1",
        columns: ["a", "b", "c", "d", "e", "f"],
      }),
    ).toThrow();
    expect(
      getProductAnalyticsColumnValuesBodySchema.parse({
        source: "fact_table",
        factTableId: "ft_1",
        columns: ["country"],
      }).limit,
    ).toBe(20);
  });
});
