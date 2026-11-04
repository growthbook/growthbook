import { describe, expect, it } from "vitest";
import type { ExplorationConfig, ShowAs } from "shared/validators";
import { toFetchKey } from "@/enterprise/components/ProductAnalytics/util";

function metricConfig(showAs?: ShowAs): ExplorationConfig {
  return {
    type: "metric",
    datasource: "ds",
    chartType: "line",
    dimensions: [],
    dateRange: { predefined: "last30Days" },
    dataset: {
      type: "metric",
      values: [
        {
          type: "metric",
          name: "Revenue",
          metricId: "revenue",
          unit: "user_id",
          denominatorUnit: null,
          rowFilters: [],
          ...(showAs ? { showAs } : {}),
        },
      ],
    },
  };
}

describe("toFetchKey", () => {
  it("ignores per-value showAs, which only affects rendering", () => {
    expect(toFetchKey(metricConfig("per_unit"))).toEqual(
      toFetchKey(metricConfig()),
    );
  });
});
