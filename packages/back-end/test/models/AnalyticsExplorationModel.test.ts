// Loaded first: the model and context import each other
import "back-end/src/services/context";
import type { ExplorationConfig } from "shared/validators";
import { AnalyticsExplorationModel } from "back-end/src/models/AnalyticsExplorationModel";

const config = {
  type: "metric",
  datasource: "ds_1",
  chartType: "line",
  dimensions: [],
  dateRange: {
    predefined: "last7Days",
    lookbackValue: null,
    lookbackUnit: null,
    startDate: null,
    endDate: null,
  },
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

const valueHashes = (metricVersions: Map<string, Date> | null) =>
  AnalyticsExplorationModel.prototype.getConfigHashes.call(
    {} as AnalyticsExplorationModel,
    config,
    null,
    metricVersions,
  )?.valueHashes;

describe("getConfigHashes", () => {
  it("keys metric values on the metric's last update", () => {
    const before = valueHashes(new Map([["fact__1", new Date("2026-11-01")]]));
    const after = valueHashes(new Map([["fact__1", new Date("2026-11-02")]]));
    expect(before).not.toEqual(after);
    expect(before).toEqual(
      valueHashes(new Map([["fact__1", new Date("2026-11-01")]])),
    );
  });
});
