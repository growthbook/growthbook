import type { MetricWindowSettings } from "shared/types/fact-table";

import {
  getEligibleUsersColumn,
  getUnitEligibilityHours,
} from "back-end/src/integrations/sql/dates/unit-eligibility";
import { factMetricFactory } from "back-end/test/factories/FactMetric.factory";

const settings = {
  skipPartialData: false,
  attributionModel: "firstExposure",
} as const;

function buildMetric(
  windowSettings: Partial<MetricWindowSettings> = {},
  overrides: Parameters<typeof factMetricFactory.build>[0] = {},
) {
  return factMetricFactory.build({
    skipPartialData: true,
    ...overrides,
    windowSettings: {
      type: "conversion",
      delayUnit: "hours",
      delayValue: 2,
      windowUnit: "hours",
      windowValue: 3.5,
      ...windowSettings,
    },
  });
}

describe("getUnitEligibilityHours", () => {
  it("is the delay plus the conversion window", () => {
    expect(getUnitEligibilityHours(buildMetric(), settings, null)).toEqual(5.5);
  });

  it("is null unless the metric opts in", () => {
    expect(
      getUnitEligibilityHours(
        buildMetric({}, { skipPartialData: false }),
        settings,
        null,
      ),
    ).toBeNull();
  });

  it("is null when the experiment already excludes in-progress conversions", () => {
    expect(
      getUnitEligibilityHours(
        buildMetric(),
        { ...settings, skipPartialData: true },
        null,
      ),
    ).toBeNull();
  });

  it("is null for a metric with no bound, even with a windowed activation metric", () => {
    expect(
      getUnitEligibilityHours(
        buildMetric({ type: "" }),
        settings,
        buildMetric(),
      ),
    ).toBeNull();
    expect(
      getUnitEligibilityHours(
        buildMetric({ type: "lookback" }),
        settings,
        null,
      ),
    ).toBeNull();
  });

  it("adds the activation metric's window to a bounded metric", () => {
    expect(
      getUnitEligibilityHours(buildMetric(), settings, buildMetric()),
    ).toEqual(11);
  });

  it("is the delay for retention with no end", () => {
    expect(
      getUnitEligibilityHours(
        buildMetric({ type: "" }, { metricType: "retention" }),
        settings,
        null,
      ),
    ).toEqual(2);
  });

  it("is null for quantile metrics", () => {
    expect(
      getUnitEligibilityHours(
        buildMetric(
          {},
          {
            metricType: "quantile",
            quantileSettings: {
              type: "unit",
              quantile: 0.5,
              ignoreZeros: false,
            },
          },
        ),
        settings,
        null,
      ),
    ).toBeNull();
  });

  it("follows the experiment's conversion window override", () => {
    // Ignoring conversion windows leaves a plain metric unbounded...
    expect(
      getUnitEligibilityHours(
        buildMetric(),
        { ...settings, attributionModel: "experimentDuration" },
        null,
      ),
    ).toBeNull();
    // ...but retention keeps its delay
    expect(
      getUnitEligibilityHours(
        buildMetric({}, { metricType: "retention" }),
        { ...settings, attributionModel: "experimentDuration" },
        null,
      ),
    ).toEqual(2);
    expect(
      getUnitEligibilityHours(
        buildMetric(),
        { ...settings, attributionModel: "lookbackOverride" },
        null,
      ),
    ).toBeNull();
  });
});

describe("getEligibleUsersColumn", () => {
  it("names the column in whole minutes", () => {
    expect(getEligibleUsersColumn(5.5)).toEqual("users_cw330m");
  });
});
