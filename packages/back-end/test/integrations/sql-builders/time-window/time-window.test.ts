/**
 * Time Window Utilities Tests
 *
 * These tests verify:
 * 1. The extracted time window utilities work correctly
 * 2. The extracted utilities produce IDENTICAL results to the original
 *    SqlIntegration private methods (parity tests)
 *
 * Methods tested:
 * - getMetricMinDelay: Calculate minimum delay for a set of metrics
 * - getMetricStart: Calculate query start date based on delays
 * - getMetricEnd: Calculate query end date based on conversion windows
 * - getMaxHoursToConvert: Calculate max hours needed for conversion
 * - getExperimentEndDate: Calculate experiment end date with skipPartialData
 */

import BigQuery from "../../../../src/integrations/BigQuery";
import { ExperimentMetricInterface } from "shared/experiments";
import { ExperimentSnapshotSettings } from "shared/types/experiment-snapshot";

// Import the EXTRACTED utilities
import * as extracted from "../../../../src/integrations/sql-builders/time-window";

// Create BigQuery instance for testing original private methods
// @ts-expect-error - context not needed for method testing
const bqInstance = new BigQuery("", {});

// Helper to access private methods from original implementation
function getPrivateMethod<T>(methodName: string): T {
  return (bqInstance as unknown as Record<string, T>)[methodName].bind(
    bqInstance
  );
}

// Get references to ORIGINAL private methods (for parity testing)
const originalGetMetricMinDelay = getPrivateMethod<
  (metrics: ExperimentMetricInterface[]) => number
>("getMetricMinDelay");

const originalGetMetricStart = getPrivateMethod<
  (initial: Date, minDelay: number, regressionAdjustmentHours: number) => Date
>("getMetricStart");

const originalGetMetricEnd = getPrivateMethod<
  (
    metrics: ExperimentMetricInterface[],
    initial?: Date,
    overrideConversionWindows?: boolean
  ) => Date | null
>("getMetricEnd");

const originalGetMaxHoursToConvert = getPrivateMethod<
  (
    funnelMetric: boolean,
    metricAndDenominatorMetrics: ExperimentMetricInterface[],
    activationMetric: ExperimentMetricInterface | null
  ) => number
>("getMaxHoursToConvert");

const originalGetExperimentEndDate = getPrivateMethod<
  (settings: ExperimentSnapshotSettings, conversionWindowHours: number) => Date
>("getExperimentEndDate");

// Use EXTRACTED utilities for all tests (same behavior expected)
const getMetricMinDelay = extracted.getMetricMinDelay;
const getMetricStart = extracted.getMetricStart;
const getMetricEnd = extracted.getMetricEnd;
const getMaxHoursToConvert = extracted.getMaxHoursToConvert;
const getExperimentEndDate = extracted.getExperimentEndDate;

// ============================================================
// Test Fixtures
// ============================================================

function createMetric(
  overrides: Partial<ExperimentMetricInterface> = {}
): ExperimentMetricInterface {
  return {
    id: "metric-1",
    windowSettings: {
      type: "conversion",
      windowUnit: "hours",
      windowValue: 72,
      delayUnit: "hours",
      delayValue: 0,
    },
    ...overrides,
  } as ExperimentMetricInterface;
}

function createSettings(
  overrides: Partial<ExperimentSnapshotSettings> = {}
): ExperimentSnapshotSettings {
  return {
    startDate: new Date("2023-01-01T00:00:00Z"),
    endDate: new Date("2023-01-31T00:00:00Z"),
    skipPartialData: false,
    experimentId: "exp-1",
    manual: false,
    regressionAdjustmentEnabled: false,
    dimensions: [],
    statsEngine: "frequentist" as const,
    pValueThreshold: 0.05,
    defaultMetricPriorSettings: {
      override: false,
      proper: false,
      mean: 0,
      stddev: 0.3,
    },
    ...overrides,
  } as ExperimentSnapshotSettings;
}

// ============================================================
// Tests for getMetricMinDelay
// ============================================================

describe("getMetricMinDelay", () => {
  it("returns 0 for metrics with no delay", () => {
    const metrics = [
      createMetric({
        windowSettings: {
          type: "conversion",
          windowUnit: "hours",
          windowValue: 72,
          delayUnit: "hours",
          delayValue: 0,
        },
      }),
    ];
    expect(getMetricMinDelay(metrics)).toBe(0);
  });

  it("returns 0 for empty metrics array", () => {
    expect(getMetricMinDelay([])).toBe(0);
  });

  it("returns negative delay for lookback metrics", () => {
    const metrics = [
      createMetric({
        windowSettings: {
          type: "conversion",
          windowUnit: "hours",
          windowValue: 72,
          delayUnit: "hours",
          delayValue: -24,
        },
      }),
    ];
    expect(getMetricMinDelay(metrics)).toBe(-24);
  });

  it("returns minimum (most negative) delay across multiple metrics", () => {
    const metrics = [
      createMetric({
        id: "m1",
        windowSettings: {
          type: "conversion",
          windowUnit: "hours",
          windowValue: 72,
          delayUnit: "hours",
          delayValue: -24,
        },
      }),
      createMetric({
        id: "m2",
        windowSettings: {
          type: "conversion",
          windowUnit: "hours",
          windowValue: 48,
          delayUnit: "hours",
          delayValue: -48,
        },
      }),
    ];
    // Running total: -24, then -24 + -48 = -72
    expect(getMetricMinDelay(metrics)).toBe(-72);
  });

  it("handles mixed positive and negative delays", () => {
    const metrics = [
      createMetric({
        id: "m1",
        windowSettings: {
          type: "conversion",
          windowUnit: "hours",
          windowValue: 72,
          delayUnit: "hours",
          delayValue: 24, // positive delay
        },
      }),
      createMetric({
        id: "m2",
        windowSettings: {
          type: "conversion",
          windowUnit: "hours",
          windowValue: 48,
          delayUnit: "hours",
          delayValue: -100, // large negative delay
        },
      }),
    ];
    // Running: 24, then 24 + -100 = -76
    expect(getMetricMinDelay(metrics)).toBe(-76);
  });

  it("ignores metrics with lookback window type", () => {
    const metrics = [
      createMetric({
        windowSettings: {
          type: "lookback",
          windowUnit: "days",
          windowValue: 7,
          delayUnit: "hours",
          delayValue: 0,
        },
      }),
    ];
    // Lookback windows don't use delay in the same way
    expect(getMetricMinDelay(metrics)).toBe(0);
  });
});

// ============================================================
// Tests for getMetricStart
// ============================================================

describe("getMetricStart", () => {
  const baseDate = new Date("2023-01-15T12:00:00Z");

  it("returns initial date when minDelay is 0 and no regression adjustment", () => {
    const result = getMetricStart(baseDate, 0, 0);
    expect(result.getTime()).toBe(baseDate.getTime());
  });

  it("does not modify date for positive delay", () => {
    const result = getMetricStart(baseDate, 24, 0);
    // Positive delay doesn't affect start date
    expect(result.getTime()).toBe(baseDate.getTime());
  });

  it("subtracts negative delay from start date", () => {
    const result = getMetricStart(baseDate, -24, 0);
    const expected = new Date(baseDate);
    expected.setHours(expected.getHours() - 24);
    expect(result.getTime()).toBe(expected.getTime());
  });

  it("subtracts regression adjustment hours", () => {
    const result = getMetricStart(baseDate, 0, 48);
    const expected = new Date(baseDate);
    expected.setHours(expected.getHours() - 48);
    expect(result.getTime()).toBe(expected.getTime());
  });

  it("combines negative delay and regression adjustment", () => {
    const result = getMetricStart(baseDate, -24, 48);
    const expected = new Date(baseDate);
    expected.setHours(expected.getHours() - 24 - 48); // Both subtract
    expect(result.getTime()).toBe(expected.getTime());
  });

  it("does not mutate the input date", () => {
    const original = new Date(baseDate);
    getMetricStart(baseDate, -24, 48);
    expect(baseDate.getTime()).toBe(original.getTime());
  });
});

// ============================================================
// Tests for getMetricEnd
// ============================================================

describe("getMetricEnd", () => {
  const baseDate = new Date("2023-01-31T00:00:00Z");

  it("returns null when initial date is undefined", () => {
    const metrics = [createMetric()];
    expect(getMetricEnd(metrics, undefined)).toBeNull();
  });

  it("returns initial date when overrideConversionWindows is true", () => {
    const metrics = [
      createMetric({
        windowSettings: {
          type: "conversion",
          windowUnit: "hours",
          windowValue: 72,
          delayUnit: "hours",
          delayValue: 0,
        },
      }),
    ];
    const result = getMetricEnd(metrics, baseDate, true);
    expect(result?.getTime()).toBe(baseDate.getTime());
  });

  it("extends end date by conversion window hours", () => {
    const metrics = [
      createMetric({
        windowSettings: {
          type: "conversion",
          windowUnit: "hours",
          windowValue: 72, // 72 hours
          delayUnit: "hours",
          delayValue: 0,
        },
      }),
    ];
    const result = getMetricEnd(metrics, baseDate);
    const expected = new Date(baseDate);
    expected.setHours(expected.getHours() + 72);
    expect(result?.getTime()).toBe(expected.getTime());
  });

  it("includes delay in end date calculation", () => {
    const metrics = [
      createMetric({
        windowSettings: {
          type: "conversion",
          windowUnit: "hours",
          windowValue: 72,
          delayUnit: "hours",
          delayValue: 24,
        },
      }),
    ];
    const result = getMetricEnd(metrics, baseDate);
    const expected = new Date(baseDate);
    expected.setHours(expected.getHours() + 72 + 24); // window + delay
    expect(result?.getTime()).toBe(expected.getTime());
  });

  it("uses max hours across multiple metrics", () => {
    const metrics = [
      createMetric({
        id: "m1",
        windowSettings: {
          type: "conversion",
          windowUnit: "hours",
          windowValue: 48,
          delayUnit: "hours",
          delayValue: 0,
        },
      }),
      createMetric({
        id: "m2",
        windowSettings: {
          type: "conversion",
          windowUnit: "hours",
          windowValue: 72,
          delayUnit: "hours",
          delayValue: 24,
        },
      }),
    ];
    // First: 48, Running: 48
    // Second: 48 + 72 + 24 = 144, Running: 144
    const result = getMetricEnd(metrics, baseDate);
    const expected = new Date(baseDate);
    expected.setHours(expected.getHours() + 144);
    expect(result?.getTime()).toBe(expected.getTime());
  });

  it("ignores non-conversion window types", () => {
    const metrics = [
      createMetric({
        windowSettings: {
          type: "lookback",
          windowUnit: "days",
          windowValue: 7,
          delayUnit: "hours",
          delayValue: 0,
        },
      }),
    ];
    const result = getMetricEnd(metrics, baseDate);
    // No conversion window, so no extension
    expect(result?.getTime()).toBe(baseDate.getTime());
  });

  it("does not mutate the input date", () => {
    const original = new Date(baseDate);
    const metrics = [createMetric()];
    getMetricEnd(metrics, baseDate);
    expect(baseDate.getTime()).toBe(original.getTime());
  });
});

// ============================================================
// Tests for getMaxHoursToConvert
// ============================================================

describe("getMaxHoursToConvert", () => {
  it("returns 0 for metrics with no conversion window", () => {
    const metrics = [
      createMetric({
        windowSettings: {
          type: "lookback",
          windowUnit: "days",
          windowValue: 7,
          delayUnit: "hours",
          delayValue: 0,
        },
      }),
    ];
    expect(getMaxHoursToConvert(false, metrics, null)).toBe(0);
  });

  it("returns conversion window + delay for single metric", () => {
    const metrics = [
      createMetric({
        windowSettings: {
          type: "conversion",
          windowUnit: "hours",
          windowValue: 72,
          delayUnit: "hours",
          delayValue: 24,
        },
      }),
    ];
    expect(getMaxHoursToConvert(false, metrics, null)).toBe(96);
  });

  it("takes max for non-funnel metrics", () => {
    const metrics = [
      createMetric({
        id: "m1",
        windowSettings: {
          type: "conversion",
          windowUnit: "hours",
          windowValue: 48,
          delayUnit: "hours",
          delayValue: 0,
        },
      }),
      createMetric({
        id: "m2",
        windowSettings: {
          type: "conversion",
          windowUnit: "hours",
          windowValue: 72,
          delayUnit: "hours",
          delayValue: 24,
        },
      }),
    ];
    // Non-funnel: max of (48+0, 72+24) = max(48, 96) = 96
    expect(getMaxHoursToConvert(false, metrics, null)).toBe(96);
  });

  it("sums windows for funnel metrics", () => {
    const metrics = [
      createMetric({
        id: "m1",
        windowSettings: {
          type: "conversion",
          windowUnit: "hours",
          windowValue: 48,
          delayUnit: "hours",
          delayValue: 0,
        },
      }),
      createMetric({
        id: "m2",
        windowSettings: {
          type: "conversion",
          windowUnit: "hours",
          windowValue: 72,
          delayUnit: "hours",
          delayValue: 24,
        },
      }),
    ];
    // Funnel: sum of (48+0) + (72+24) = 48 + 96 = 144
    expect(getMaxHoursToConvert(true, metrics, null)).toBe(144);
  });

  it("adds activation metric window", () => {
    const metrics = [
      createMetric({
        windowSettings: {
          type: "conversion",
          windowUnit: "hours",
          windowValue: 48,
          delayUnit: "hours",
          delayValue: 0,
        },
      }),
    ];
    const activation = createMetric({
      id: "activation",
      windowSettings: {
        type: "conversion",
        windowUnit: "hours",
        windowValue: 24,
        delayUnit: "hours",
        delayValue: 12,
      },
    });
    // Metric: 48, Activation: 24+12=36, Total: 48+36=84
    expect(getMaxHoursToConvert(false, metrics, activation)).toBe(84);
  });

  it("ignores activation metric with non-conversion window", () => {
    const metrics = [
      createMetric({
        windowSettings: {
          type: "conversion",
          windowUnit: "hours",
          windowValue: 48,
          delayUnit: "hours",
          delayValue: 0,
        },
      }),
    ];
    const activation = createMetric({
      id: "activation",
      windowSettings: {
        type: "lookback",
        windowUnit: "days",
        windowValue: 7,
        delayUnit: "hours",
        delayValue: 0,
      },
    });
    expect(getMaxHoursToConvert(false, metrics, activation)).toBe(48);
  });
});

// ============================================================
// Tests for getExperimentEndDate
// ============================================================

describe("getExperimentEndDate", () => {
  // Mock the Date constructor to control "now"
  const RealDate = global.Date;
  const mockNow = new RealDate("2023-02-15T00:00:00Z").getTime();

  beforeAll(() => {
    // Override Date to use a fixed "now" for new Date() calls
    global.Date = class extends RealDate {
      constructor(...args: ConstructorParameters<typeof RealDate>) {
        if (args.length === 0) {
          super(mockNow);
        } else {
          // @ts-expect-error - spread args to parent constructor
          super(...args);
        }
      }

      static now() {
        return mockNow;
      }
    } as typeof Date;
  });

  afterAll(() => {
    global.Date = RealDate;
  });

  it("returns endDate when skipPartialData is false", () => {
    const settings = createSettings({
      endDate: new RealDate("2023-01-31T00:00:00Z"),
      skipPartialData: false,
    });
    const result = getExperimentEndDate(settings, 72);
    expect(result.getTime()).toBe(settings.endDate.getTime());
  });

  it("returns endDate when skipPartialData is true but endDate is before conversion window", () => {
    const settings = createSettings({
      endDate: new RealDate("2023-01-15T00:00:00Z"), // Well before "now"
      skipPartialData: true,
    });
    // Now is 2023-02-15, conversion window is 72 hours
    // Conversion window end would be 2023-02-12
    // endDate (Jan 15) is before that, so use endDate
    const result = getExperimentEndDate(settings, 72);
    expect(result.getTime()).toBe(settings.endDate.getTime());
  });

  it("returns conversion window end date when it's before endDate", () => {
    const settings = createSettings({
      endDate: new RealDate("2023-03-01T00:00:00Z"), // After "now"
      skipPartialData: true,
    });
    // Now is 2023-02-15T00:00:00Z, conversion window is 72 hours
    // Conversion window end = 2023-02-15 - 72 hours = 2023-02-12T00:00:00Z
    const result = getExperimentEndDate(settings, 72);
    const expected = new RealDate(mockNow - 72 * 60 * 60 * 1000);
    expect(result.getTime()).toBe(expected.getTime());
  });

  it("handles 0 conversion window hours", () => {
    const settings = createSettings({
      endDate: new RealDate("2023-03-01T00:00:00Z"),
      skipPartialData: true,
    });
    // With 0 conversion window, uses "now" as the end date
    const result = getExperimentEndDate(settings, 0);
    // Should be min of (endDate, now) = now since endDate is in future
    expect(result.getTime()).toBe(mockNow);
  });

  it("handles large conversion window", () => {
    const settings = createSettings({
      endDate: new RealDate("2023-03-01T00:00:00Z"),
      skipPartialData: true,
    });
    // 30 days = 720 hours
    const result = getExperimentEndDate(settings, 720);
    const expected = new RealDate(mockNow - 720 * 60 * 60 * 1000);
    expect(result.getTime()).toBe(expected.getTime());
  });
});

// ============================================================
// Integration-style tests
// ============================================================

describe("Time Window Integration", () => {
  it("calculates consistent windows for a typical experiment", () => {
    const startDate = new Date("2023-01-01T00:00:00Z");
    const endDate = new Date("2023-01-31T00:00:00Z");

    const metric = createMetric({
      windowSettings: {
        type: "conversion",
        windowUnit: "hours",
        windowValue: 72,
        delayUnit: "hours",
        delayValue: 0,
      },
    });

    const minDelay = getMetricMinDelay([metric]);
    const metricStart = getMetricStart(startDate, minDelay, 0);
    const metricEnd = getMetricEnd([metric], endDate);
    const maxHours = getMaxHoursToConvert(false, [metric], null);

    expect(minDelay).toBe(0);
    expect(metricStart.getTime()).toBe(startDate.getTime());
    expect(metricEnd?.getTime()).toBe(
      new Date("2023-02-03T00:00:00Z").getTime() // +72 hours
    );
    expect(maxHours).toBe(72);
  });

  it("handles complex metric with lookback delay", () => {
    const startDate = new Date("2023-01-15T00:00:00Z");
    const endDate = new Date("2023-01-31T00:00:00Z");

    const metric = createMetric({
      windowSettings: {
        type: "conversion",
        windowUnit: "hours",
        windowValue: 48,
        delayUnit: "hours",
        delayValue: -24, // Lookback 24 hours before exposure
      },
    });

    const minDelay = getMetricMinDelay([metric]);
    const metricStart = getMetricStart(startDate, minDelay, 0);
    const metricEnd = getMetricEnd([metric], endDate);

    expect(minDelay).toBe(-24);
    // Start date moves back by 24 hours
    expect(metricStart.getTime()).toBe(
      new Date("2023-01-14T00:00:00Z").getTime()
    );
    // End date extends by window + delay (48 + (-24) = 24 hours)
    expect(metricEnd?.getTime()).toBe(
      new Date("2023-01-31T00:00:00Z").getTime() + 24 * 60 * 60 * 1000
    );
  });
});

// ============================================================
// PARITY TESTS: Verify extracted code matches original
// ============================================================

describe("Parity Tests: Extracted vs Original", () => {
  describe("getMetricMinDelay parity", () => {
    const testCases = [
      { name: "empty array", metrics: [] },
      {
        name: "single metric no delay",
        metrics: [
          createMetric({
            windowSettings: {
              type: "conversion",
              windowUnit: "hours",
              windowValue: 72,
              delayUnit: "hours",
              delayValue: 0,
            },
          }),
        ],
      },
      {
        name: "single metric with negative delay",
        metrics: [
          createMetric({
            windowSettings: {
              type: "conversion",
              windowUnit: "hours",
              windowValue: 72,
              delayUnit: "hours",
              delayValue: -24,
            },
          }),
        ],
      },
      {
        name: "multiple metrics cascading delays",
        metrics: [
          createMetric({
            id: "m1",
            windowSettings: {
              type: "conversion",
              windowUnit: "hours",
              windowValue: 48,
              delayUnit: "hours",
              delayValue: -24,
            },
          }),
          createMetric({
            id: "m2",
            windowSettings: {
              type: "conversion",
              windowUnit: "hours",
              windowValue: 72,
              delayUnit: "hours",
              delayValue: -48,
            },
          }),
        ],
      },
    ];

    testCases.forEach(({ name, metrics }) => {
      it(`matches original for ${name}`, () => {
        expect(extracted.getMetricMinDelay(metrics)).toBe(
          originalGetMetricMinDelay(metrics)
        );
      });
    });
  });

  describe("getMetricStart parity", () => {
    const baseDate = new Date("2023-01-15T12:00:00Z");
    const testCases = [
      { name: "no adjustments", minDelay: 0, regression: 0 },
      { name: "negative delay", minDelay: -24, regression: 0 },
      { name: "regression adjustment", minDelay: 0, regression: 48 },
      { name: "both adjustments", minDelay: -24, regression: 48 },
      { name: "positive delay (ignored)", minDelay: 24, regression: 0 },
    ];

    testCases.forEach(({ name, minDelay, regression }) => {
      it(`matches original for ${name}`, () => {
        expect(
          extracted.getMetricStart(baseDate, minDelay, regression).getTime()
        ).toBe(originalGetMetricStart(baseDate, minDelay, regression).getTime());
      });
    });
  });

  describe("getMetricEnd parity", () => {
    const baseDate = new Date("2023-01-31T00:00:00Z");

    it("matches original for undefined initial", () => {
      const metrics = [createMetric()];
      expect(extracted.getMetricEnd(metrics, undefined)).toBe(
        originalGetMetricEnd(metrics, undefined)
      );
    });

    it("matches original for override=true", () => {
      const metrics = [createMetric()];
      expect(extracted.getMetricEnd(metrics, baseDate, true)?.getTime()).toBe(
        originalGetMetricEnd(metrics, baseDate, true)?.getTime()
      );
    });

    const metricCases = [
      {
        name: "single conversion metric",
        metrics: [
          createMetric({
            windowSettings: {
              type: "conversion",
              windowUnit: "hours",
              windowValue: 72,
              delayUnit: "hours",
              delayValue: 0,
            },
          }),
        ],
      },
      {
        name: "metric with delay",
        metrics: [
          createMetric({
            windowSettings: {
              type: "conversion",
              windowUnit: "hours",
              windowValue: 72,
              delayUnit: "hours",
              delayValue: 24,
            },
          }),
        ],
      },
      {
        name: "lookback metric",
        metrics: [
          createMetric({
            windowSettings: {
              type: "lookback",
              windowUnit: "days",
              windowValue: 7,
              delayUnit: "hours",
              delayValue: 0,
            },
          }),
        ],
      },
    ];

    metricCases.forEach(({ name, metrics }) => {
      it(`matches original for ${name}`, () => {
        expect(extracted.getMetricEnd(metrics, baseDate)?.getTime()).toBe(
          originalGetMetricEnd(metrics, baseDate)?.getTime()
        );
      });
    });
  });

  describe("getMaxHoursToConvert parity", () => {
    const metric72h = createMetric({
      windowSettings: {
        type: "conversion",
        windowUnit: "hours",
        windowValue: 72,
        delayUnit: "hours",
        delayValue: 24,
      },
    });

    const metric48h = createMetric({
      id: "m2",
      windowSettings: {
        type: "conversion",
        windowUnit: "hours",
        windowValue: 48,
        delayUnit: "hours",
        delayValue: 0,
      },
    });

    const activation = createMetric({
      id: "activation",
      windowSettings: {
        type: "conversion",
        windowUnit: "hours",
        windowValue: 24,
        delayUnit: "hours",
        delayValue: 12,
      },
    });

    const testCases = [
      { name: "single metric, no funnel", funnel: false, metrics: [metric72h], activation: null },
      { name: "single metric, funnel", funnel: true, metrics: [metric72h], activation: null },
      { name: "multiple metrics, no funnel", funnel: false, metrics: [metric48h, metric72h], activation: null },
      { name: "multiple metrics, funnel", funnel: true, metrics: [metric48h, metric72h], activation: null },
      { name: "with activation", funnel: false, metrics: [metric48h], activation },
    ];

    testCases.forEach(({ name, funnel, metrics, activation: act }) => {
      it(`matches original for ${name}`, () => {
        expect(extracted.getMaxHoursToConvert(funnel, metrics, act)).toBe(
          originalGetMaxHoursToConvert(funnel, metrics, act)
        );
      });
    });
  });

  describe("getExperimentEndDate parity", () => {
    it("matches original when skipPartialData=false", () => {
      const settings = createSettings({
        endDate: new Date("2023-01-31T00:00:00Z"),
        skipPartialData: false,
      });
      expect(extracted.getExperimentEndDate(settings, 72).getTime()).toBe(
        originalGetExperimentEndDate(settings, 72).getTime()
      );
    });

    it("matches original when endDate is before conversion window", () => {
      const settings = createSettings({
        endDate: new Date("2023-01-15T00:00:00Z"),
        skipPartialData: true,
      });
      expect(extracted.getExperimentEndDate(settings, 72).getTime()).toBe(
        originalGetExperimentEndDate(settings, 72).getTime()
      );
    });
  });
});
