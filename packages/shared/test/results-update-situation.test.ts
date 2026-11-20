import type { MetricStatsEngineInputs } from "shared/types/experiment-snapshot";
import {
  getNewMetricsUpdateRefusal,
  type PlannedNewMetricsUpdate,
} from "../src/experiments/new-metrics-update";

const HOUR = 60 * 60 * 1000;
const NOW = new Date("2026-03-01T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * HOUR);

const inputs: MetricStatsEngineInputs = {
  inverse: false,
  properPrior: false,
  properPriorMean: 0,
  properPriorStdDev: 0.3,
  targetMDE: 0.1,
  businessMetricTypes: ["goal"],
};
const cuped = (regressionAdjustmentEnabled: boolean) => ({
  computedSettings: { regressionAdjustmentEnabled },
});

type Args = Parameters<typeof getNewMetricsUpdateRefusal>[0];
type Parent = Args["parent"];

function makeParent(overrides: Partial<Parent> = {}): Parent {
  return {
    runnerKind: "results",
    ...overrides,
    settings: {
      endDate: hoursAgo(1),
      metricSettings: [{ id: "met_a", ...cuped(true) }],
      metricStatsEngineInputs: [{ id: "met_a", ...inputs }],
      ...overrides.settings,
    } as Parent["settings"],
  };
}

function makePlanned(
  overrides: Partial<PlannedNewMetricsUpdate> & {
    settings?: Partial<PlannedNewMetricsUpdate["settings"]>;
  } = {},
): PlannedNewMetricsUpdate {
  return {
    runnerKind: "results",
    ...overrides,
    settings: {
      metricSettings: [{ id: "met_a", ...cuped(true) }],
      metricStatsEngineInputs: [{ id: "met_a", ...inputs }],
      ...overrides.settings,
    },
  };
}

const phases = [
  { dateStarted: "2026-01-01", dateEnded: "2026-01-10" },
  { dateStarted: "2026-01-10" },
];

function refusal(overrides: Partial<Args> = {}) {
  return getNewMetricsUpdateRefusal({
    experiment: { type: "standard", phases },
    phase: 1,
    separateExperimentResultQueries: true,
    parent: makeParent(),
    outdatedReasons: ["metrics_changed"],
    window: { windowHours: 4, now: NOW },
    planned: makePlanned(),
    ...overrides,
  });
}

describe("getNewMetricsUpdateRefusal", () => {
  it("accepts a running latest phase whose only change is added metrics", () => {
    expect(refusal()).toBeNull();
    expect(refusal({ experiment: { type: undefined, phases } })).toBeNull();
  });

  describe("the window, from the parent's end date", () => {
    it.each<[string, Date, number, boolean]>([
      ["recent results", hoursAgo(1), 4, true],
      [
        "results just inside the window",
        new Date(NOW.getTime() - 4 * HOUR + 1),
        4,
        true,
      ],
      ["results exactly at the window", hoursAgo(4), 4, false],
      ["results older than the window", hoursAgo(5), 4, false],
      ["a window of 0", NOW, 0, false],
    ])("%s", (name, endDate, windowHours, accepted) => {
      expect(
        refusal({
          parent: makeParent({
            settings: { endDate } as Parent["settings"],
          }),
          window: { windowHours, now: NOW },
        }),
      ).toBe(accepted ? null : "outside_window");
    });

    it("applies none without a window", () => {
      expect(
        refusal({
          parent: makeParent({
            settings: { endDate: hoursAgo(500) } as Parent["settings"],
          }),
          window: null,
        }),
      ).toBeNull();
    });

    it("reads an end date sent as a string", () => {
      expect(
        refusal({
          parent: makeParent({
            settings: {
              endDate: hoursAgo(5).toISOString(),
            } as unknown as Parent["settings"],
          }),
        }),
      ).toBe("outside_window");
    });
  });

  it("refuses what the experiment, its Data Source and the phase rule out", () => {
    expect(refusal({ experiment: { type: "holdout", phases } })).toBe(
      "unsupported_experiment_type",
    );
    expect(refusal({ phase: 0 })).toBe("not_latest_phase");
    expect(refusal({ separateExperimentResultQueries: false })).toBe(
      "unsupported_data_source",
    );
    expect(
      refusal({
        experiment: {
          type: "standard",
          phases: [{ dateEnded: "2026-02-01" }],
        },
        phase: 0,
      }),
    ).toBe("phase_ended");
    expect(
      refusal({
        outdatedReasons: ["metrics_changed", "analysis_dates_changed"],
      }),
    ).toBe("analysis_dates_changed");
  });

  describe("the pipeline", () => {
    it.each<
      [
        Parent["runnerKind"],
        PlannedNewMetricsUpdate["runnerKind"],
        ReturnType<typeof refusal>,
      ]
    >([
      ["results", "results", null],
      [undefined, "results", null],
      ["incremental-update", "incremental-update", null],
      ["incremental-full", "incremental-update", null],
      ["results", "incremental-update", "metric_not_supported"],
      ["incremental-update", "results", "metric_not_supported"],
      ["results", "incremental-full", "incremental_pipeline"],
      ["incremental-update", "incremental-full", "incremental_pipeline"],
    ])(
      "from a %s parent to a planned %s run: %s",
      (parentRunnerKind, plannedRunnerKind, expected) => {
        expect(
          refusal({
            parent: makeParent({ runnerKind: parentRunnerKind }),
            planned: makePlanned({ runnerKind: plannedRunnerKind }),
          }),
        ).toBe(expected);
      },
    );
  });

  it.each<[string, Args["outdatedReasons"]]>([
    ["a setting changed with the metrics", ["segment", "metrics_changed"]],
    [
      "newer Overall results exist",
      ["metrics_changed", "newer_overall_results"],
    ],
    ["CUPED changed for an adjusted metric", ["metrics_changed", "cuped"]],
  ])("refuses when %s", (name, outdatedReasons) => {
    expect(refusal({ outdatedReasons })).toBe("settings_changed");
  });

  describe("a CUPED change", () => {
    const outdatedReasons: Args["outdatedReasons"] = [
      "metrics_changed",
      "cuped",
    ];
    const withCuped = (parentFlag: boolean, plannedFlag: boolean | null) =>
      refusal({
        outdatedReasons,
        parent: makeParent({
          settings: {
            metricSettings: [{ id: "met_a", ...cuped(parentFlag) }],
          } as Parent["settings"],
        }),
        planned: makePlanned({
          settings: {
            metricSettings: [
              plannedFlag === null
                ? { id: "met_a" }
                : { id: "met_a", ...cuped(plannedFlag) },
            ],
          },
        }),
      });

    it("is accepted while every copied metric opts out, as stored and as planned", () => {
      expect(withCuped(false, false)).toBeNull();
    });

    it("is refused when a copied metric was adjusted, would be adjusted now, or has no planned flag", () => {
      expect(withCuped(true, false)).toBe("settings_changed");
      expect(withCuped(false, true)).toBe("settings_changed");
      expect(withCuped(false, null)).toBe("settings_changed");
    });

    it("ignores a parent metric the plan no longer has", () => {
      expect(
        refusal({
          outdatedReasons,
          parent: makeParent({
            settings: {
              metricSettings: [
                { id: "met_a", ...cuped(false) },
                { id: "met_gone", ...cuped(false) },
              ],
            } as Parent["settings"],
          }),
          planned: makePlanned({
            settings: { metricSettings: [{ id: "met_a", ...cuped(false) }] },
          }),
        }),
      ).toBeNull();
    });
  });

  describe("the stats engine inputs of copied metrics", () => {
    it("refuses when one changed or the plan has none for it", () => {
      expect(
        refusal({
          planned: makePlanned({
            settings: {
              metricStatsEngineInputs: [
                { id: "met_a", ...inputs, inverse: true },
              ],
            },
          }),
        }),
      ).toBe("settings_changed");
      expect(
        refusal({
          planned: makePlanned({ settings: { metricStatsEngineInputs: [] } }),
        }),
      ).toBe("settings_changed");
    });

    it("compares only metrics the plan still has", () => {
      expect(
        refusal({
          parent: makeParent({
            settings: {
              metricSettings: [
                { id: "met_a", ...cuped(true) },
                { id: "met_gone", ...cuped(true) },
              ],
            } as Parent["settings"],
          }),
        }),
      ).toBeNull();
    });
  });
});
