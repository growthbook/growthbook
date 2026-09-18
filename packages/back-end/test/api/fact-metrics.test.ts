import { OrganizationInterface } from "shared/types/organization";
import { postFactMetricValidator } from "shared/validators";
import { getCreateMetricPropsFromBody } from "back-end/src/api/fact-metrics/postFactMetric";
import { factTableFactory } from "back-end/test/factories/FactTable.factory";

describe("Fact Metric API payload normalization", () => {
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
});
