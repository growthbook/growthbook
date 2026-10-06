import { OrganizationInterface } from "shared/types/organization";
import {
  postBulkImportFactsValidator,
  postFactMetricValidator,
  updateFactMetricValidator,
} from "shared/validators";
import { getCreateMetricPropsFromBody } from "back-end/src/api/fact-metrics/postFactMetric";
import { getUpdateFactMetricPropsFromBody } from "back-end/src/api/fact-metrics/updateFactMetric";
import { factTableFactory } from "back-end/test/factories/FactTable.factory";
import { factMetricFactory } from "back-end/test/factories/FactMetric.factory";

describe("Fact Metric API payload normalization", () => {
  const factTable = factTableFactory.build({ id: "ft_events" });
  const organization = { settings: {} } as OrganizationInterface;
  const getFactTable = async () => factTable;
  const numerator = { factTableId: factTable.id, column: "value" };
  const metric = factMetricFactory.build({
    metricType: "mean",
    numerator,
    cappingSettings: { type: "percentile", value: 0.99 },
    lowerCappingSettings: { type: "absolute", value: -10 },
  });

  it("creates a lower-only cap from a top-level field", async () => {
    const body = postFactMetricValidator.bodySchema.parse({
      name: "Revenue",
      metricType: "mean",
      numerator,
      lowerCappingSettings: { type: "absolute", value: 0 },
    });
    const result = await getCreateMetricPropsFromBody(
      body,
      organization,
      getFactTable,
    );
    expect(result.cappingSettings).toEqual({ type: "", value: 0 });
    expect(result.lowerCappingSettings).toEqual({
      type: "absolute",
      value: 0,
      ignoreZeros: false,
    });
  });

  it.each(["cappingSettings", "lowerCappingSettings"] as const)(
    "rejects an absolute %s on ratio create",
    async (tail) => {
      const body = postFactMetricValidator.bodySchema.parse({
        name: "Revenue per order",
        metricType: "ratio",
        numerator,
        denominator: numerator,
        [tail]: { type: "absolute", value: 100 },
      });
      await expect(
        getCreateMetricPropsFromBody(body, organization, getFactTable),
      ).rejects.toThrow("Ratio metrics support only percentile capping.");
    },
  );

  it("updates the lower cap without changing the upper cap", async () => {
    const result = await getUpdateFactMetricPropsFromBody(
      updateFactMetricValidator.bodySchema.parse({
        lowerCappingSettings: { type: "absolute", value: -5 },
      }),
      metric,
      getFactTable,
    );
    expect(result).not.toHaveProperty("cappingSettings");
    expect(result.lowerCappingSettings).toEqual({
      type: "absolute",
      value: -5,
      ignoreZeros: false,
    });
  });

  it("preserves the lower cap when it is omitted", async () => {
    const result = await getUpdateFactMetricPropsFromBody(
      updateFactMetricValidator.bodySchema.parse({
        cappingSettings: { type: "percentile", value: 0.95 },
      }),
      metric,
      getFactTable,
    );
    expect(result).not.toHaveProperty("lowerCappingSettings");
  });

  it.each([null, { type: "none" }])(
    "clears the lower cap with %j without changing the upper cap",
    async (lowerCappingSettings) => {
      const result = await getUpdateFactMetricPropsFromBody(
        updateFactMetricValidator.bodySchema.parse({ lowerCappingSettings }),
        metric,
        getFactTable,
      );
      expect(result.lowerCappingSettings).toBeNull();
      expect(result).not.toHaveProperty("cappingSettings");
    },
  );

  it("rejects an invalid percentile instead of clearing it", async () => {
    await expect(
      getUpdateFactMetricPropsFromBody(
        updateFactMetricValidator.bodySchema.parse({
          lowerCappingSettings: { type: "percentile", value: 5 },
        }),
        metric,
        getFactTable,
      ),
    ).rejects.toThrow("lowerCappingSettings.value");
    expect(metric.lowerCappingSettings?.value).toBe(-10);
  });

  it("uses the funnel step Fact Table and stores a null numerator", async () => {
    const factTable = factTableFactory.build({
      id: "ft_events",
      datasource: "ds_events",
    });
    const getFactTable = jest.fn().mockResolvedValue(factTable);
    const body = postFactMetricValidator.bodySchema.parse({
      name: "Checkout funnel",
      metricType: "funnel",
      funnelSettings: {
        steps: [
          {
            name: "Viewed product",
            factTableId: factTable.id,
            rowFilters: [],
            optional: false,
          },
          {
            name: "Purchased",
            factTableId: factTable.id,
            rowFilters: [],
            optional: false,
          },
        ],
      },
    });

    const result = await getCreateMetricPropsFromBody(
      body,
      { settings: {} } as OrganizationInterface,
      getFactTable,
    );

    expect(getFactTable).toHaveBeenCalledWith(factTable.id);
    expect(result.datasource).toEqual(factTable.datasource);
    expect(result.numerator).toBeNull();
  });

  it.each(["cappingSettings", "lowerCappingSettings"] as const)(
    "rejects missing values and out-of-range percentiles on %s create and update",
    async (key) => {
      for (const type of ["absolute", "percentile"] as const) {
        const body = postFactMetricValidator.bodySchema.parse({
          name: "Revenue",
          metricType: "mean",
          numerator,
          [key]: { type },
        });
        await expect(
          getCreateMetricPropsFromBody(body, organization, getFactTable),
        ).rejects.toThrow(`${key}.value`);
      }
      for (const value of [0, 1, 5, -1]) {
        const body = updateFactMetricValidator.bodySchema.parse({
          [key]: { type: "percentile", value },
        });
        await expect(
          getUpdateFactMetricPropsFromBody(body, metric, getFactTable),
        ).rejects.toThrow(`${key}.value`);
      }
    },
  );

  it("preserves the same-type value but rejects reuse across different types", async () => {
    const result = await getUpdateFactMetricPropsFromBody(
      { lowerCappingSettings: { type: "absolute" } },
      metric,
      getFactTable,
    );
    expect(result.lowerCappingSettings?.value).toBe(-10);
    await expect(
      getUpdateFactMetricPropsFromBody(
        { lowerCappingSettings: { type: "percentile" } },
        metric,
        getFactTable,
      ),
    ).rejects.toThrow("lowerCappingSettings.value");
  });

  it("leaves legacy caps untouched on unrelated edits", async () => {
    const legacy = {
      ...metric,
      metricType: "ratio" as const,
      denominator: numerator,
      cappingSettings: { type: "absolute" as const, value: 100 },
      lowerCappingSettings: { type: "percentile" as const, value: 0 },
    };
    const result = await getUpdateFactMetricPropsFromBody(
      { name: "Renamed" },
      legacy,
      getFactTable,
    );
    expect(result).not.toHaveProperty("cappingSettings");
    expect(result).not.toHaveProperty("lowerCappingSettings");
  });

  const funnelSettings = {
    steps: [
      {
        name: "View",
        factTableId: factTable.id,
        rowFilters: [],
        optional: false,
      },
      {
        name: "Purchase",
        factTableId: factTable.id,
        rowFilters: [],
        optional: false,
      },
    ],
  };

  it("requires explicit disabling when changing to a funnel", async () => {
    const body = updateFactMetricValidator.bodySchema.parse({
      metricType: "funnel",
      funnelSettings,
    });
    await expect(
      getUpdateFactMetricPropsFromBody(body, metric, getFactTable),
    ).rejects.toThrow(/Disable both tails explicitly/);
    const result = await getUpdateFactMetricPropsFromBody(
      {
        ...body,
        cappingSettings: { type: "none" },
        lowerCappingSettings: null,
      },
      metric,
      getFactTable,
    );
    expect(result.cappingSettings?.type).toBe("");
    expect(result.lowerCappingSettings).toBeNull();
  });

  it.each(["cappingSettings", "lowerCappingSettings"] as const)(
    "rejects %s on existing and new funnels",
    async (key) => {
      const body = postFactMetricValidator.bodySchema.parse({
        name: "Funnel",
        metricType: "funnel",
        funnelSettings,
        [key]: { type: "percentile", value: 0.5 },
      });
      await expect(
        getCreateMetricPropsFromBody(body, organization, getFactTable),
      ).rejects.toThrow(/not supported/);
      const existing = factMetricFactory.build({
        metricType: "funnel",
        numerator: null,
        funnelSettings,
        cappingSettings: { type: "", value: 0 },
        lowerCappingSettings: null,
      });
      await expect(
        getUpdateFactMetricPropsFromBody(
          { [key]: { type: "percentile", value: 0.5 } },
          existing,
          getFactTable,
        ),
      ).rejects.toThrow(/not supported/);
    },
  );

  it("rejects invalid bulk input through the conversion shared by dry runs and writes", async () => {
    const parsed = postBulkImportFactsValidator.bodySchema.parse({
      factMetrics: [
        {
          id: "revenue",
          data: {
            name: "Revenue",
            metricType: "mean",
            numerator,
            lowerCappingSettings: { type: "percentile", value: 5 },
          },
        },
      ],
    });
    const body = parsed.factMetrics![0].data;
    await expect(
      getCreateMetricPropsFromBody(body, organization, getFactTable),
    ).rejects.toThrow("lowerCappingSettings.value");
    await expect(
      getUpdateFactMetricPropsFromBody(body, metric, getFactTable),
    ).rejects.toThrow("lowerCappingSettings.value");
  });
});
