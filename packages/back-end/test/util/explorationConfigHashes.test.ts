import type { ExplorationConfig } from "shared/validators";
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

const valueHashes = (updated: string) =>
  getExplorationConfigHashes(
    config,
    null,
    new Map([["fact__1", new Date(updated)]]),
  )?.valueHashes;

describe("getExplorationConfigHashes", () => {
  it("keys metric values on the metric's last update", () => {
    expect(valueHashes("2026-11-01")).not.toEqual(valueHashes("2026-11-02"));
    expect(valueHashes("2026-11-01")).toEqual(valueHashes("2026-11-01"));
  });
});
