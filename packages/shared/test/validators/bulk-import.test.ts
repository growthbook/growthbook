import {
  apiMetricTypeEnum,
  postBulkImportFactsValidator,
  postFactMetricValidator,
} from "../../src/validators";

const funnelSettings = {
  steps: [
    {
      name: "Viewed",
      factTableId: "ft_1",
      rowFilters: [],
      optional: false,
    },
    {
      name: "Purchased",
      factTableId: "ft_1",
      rowFilters: [],
      optional: false,
    },
  ],
};

const parseBulk = (body: unknown) =>
  postBulkImportFactsValidator.bodySchema.safeParse(body);

const metricPayload = (
  metricType: (typeof apiMetricTypeEnum.options)[number],
) =>
  metricType === "funnel"
    ? { name: "Checkout funnel", metricType, funnelSettings }
    : {
        name: "Test",
        metricType,
        numerator: { factTableId: "ft_1", column: "amount" },
        ...(metricType === "ratio"
          ? { denominator: { factTableId: "ft_1", column: "$$count" } }
          : {}),
      };

describe("postBulkImportFacts body", () => {
  it("accepts every metricType the single-metric create endpoint accepts", () => {
    for (const metricType of apiMetricTypeEnum.options) {
      expect(
        postFactMetricValidator.bodySchema.safeParse(metricPayload(metricType))
          .success,
      ).toBe(true);
      expect(
        parseBulk({
          factMetrics: [{ id: "fact__test", data: metricPayload(metricType) }],
        }).success,
      ).toBe(true);
    }
  });

  it("rejects a funnel metric that includes a numerator", () => {
    const result = parseBulk({
      factMetrics: [
        {
          id: "fact__funnel",
          data: {
            name: "Checkout funnel",
            metricType: "funnel",
            numerator: { factTableId: "ft_1", column: "$$distinctUsers" },
            funnelSettings,
          },
        },
      ],
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues.some((i) => i.path.includes("numerator"))).toBe(
      true,
    );
  });

  it("accepts unknown keys on fact metric data", () => {
    const result = parseBulk({
      factMetrics: [
        {
          id: "fact__test",
          data: {
            name: "Test",
            metricType: "mean",
            numerator: { factTableId: "ft_1", column: "amount" },
            extraField: true,
            datasource: "ds_1",
          },
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("accepts unknown keys on fact table filter data", () => {
    const result = parseBulk({
      factTableFilters: [
        {
          factTableId: "orders",
          id: "high_value",
          data: {
            name: "High Value",
            value: "amount > 120",
            dateCreated: "2026-01-01T00:00:00.000Z",
          },
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("accepts defaultManagedBy and dryRun", () => {
    const result = parseBulk({
      defaultManagedBy: "",
      dryRun: true,
      factTables: [],
    });
    expect(result.success).toBe(true);
    expect(result.data?.defaultManagedBy).toBe("");
    expect(result.data?.dryRun).toBe(true);
  });
});
