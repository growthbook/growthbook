import { pick } from "lodash";
import type { ExplorationConfig } from "shared/validators";
import type { FactMetricInterface } from "shared/types/fact-table";
import { EXPLORATION_METRIC_QUERY_FIELDS } from "shared/enterprise";
import { getExplorationConfigHashes } from "back-end/src/util/explorationConfigHashes";

const config = {
  type: "metric",
  datasource: "ds_1",
  chartType: "line",
  dimensions: [],
  dateRange: { predefined: "last7Days" },
  dataset: {
    type: "metric",
    values: [
      {
        type: "metric",
        name: "Revenue",
        metricId: "fact__1",
        unit: "user_id",
        denominatorUnit: null,
        rowFilters: [],
      },
    ],
  },
} as unknown as ExplorationConfig;

const metric = {
  id: "fact__1",
  name: "Revenue",
  description: "",
  dateUpdated: new Date("2026-11-01"),
  metricType: "mean",
  numerator: { factTableId: "ftb_1", column: "amount", rowFilters: [] },
  denominator: null,
  cappingSettings: { type: "", value: 0 },
  windowSettings: { type: "" },
  quantileSettings: null,
} as unknown as FactMetricInterface;

// Mirrors how the exploration service builds the map
const valueHashes = (m: FactMetricInterface) =>
  getExplorationConfigHashes(
    config,
    null,
    new Map([[m.id, pick(m, EXPLORATION_METRIC_QUERY_FIELDS)]]),
  )?.valueHashes;

describe("getExplorationConfigHashes", () => {
  it("keeps the hash when only metric metadata changes", () => {
    expect(
      valueHashes({
        ...metric,
        name: "Renamed",
        description: "New description",
        dateUpdated: new Date("2026-11-02"),
      }),
    ).toEqual(valueHashes(metric));
  });

  it("changes the hash when a query field changes", () => {
    expect(
      valueHashes({
        ...metric,
        numerator: { ...metric.numerator, column: "net_amount" },
      }),
    ).not.toEqual(valueHashes(metric));
    expect(
      valueHashes({
        ...metric,
        cappingSettings: { type: "absolute", value: 100 },
      } as FactMetricInterface),
    ).not.toEqual(valueHashes(metric));
  });
});
