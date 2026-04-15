import { sequentialPValues } from "back-end/src/util/ssrm";
import {
  computeTrafficSrm,
  computeDimensionSrm,
  computePerDaySequentialSrm,
  extractSrmDailyUsers,
  type SrmSettings,
} from "back-end/src/services/stats";

// ---------------------------------------------------------------------------
// Helper: check relative closeness for very small p-values
// ---------------------------------------------------------------------------
function expectRelativelyClose(
  actual: number,
  expected: number,
  relTol = 1e-6,
) {
  expect(actual).toBeGreaterThan(expected * (1 - relTol));
  expect(actual).toBeLessThan(expected * (1 + relTol));
}

// ---------------------------------------------------------------------------
// sequentialPValues (ssrm.ts)
// ---------------------------------------------------------------------------
// Reference values are computed with the Python reference implementation
// packages/stats/gbstats/ssrm.sequential_p_values().
// Python returns len(data)+1 values (includes initial=1 via itertools.accumulate);
// TypeScript returns len(data) values, i.e. Python result[1:].
// ---------------------------------------------------------------------------

describe("sequentialPValues", () => {
  it("returns an empty array for empty data", () => {
    expect(sequentialPValues([], [0.5, 0.5])).toEqual([]);
  });

  it("returns an array with the same length as the input data", () => {
    const result = sequentialPValues(
      [
        [500, 500],
        [600, 400],
        [700, 300],
      ],
      [0.5, 0.5],
    );
    expect(result).toHaveLength(3);
  });

  it("all returned p-values are in [0, 1]", () => {
    const data = [
      [500, 500],
      [800, 200],
      [300, 700],
    ];
    for (const p of sequentialPValues(data, [0.5, 0.5])) {
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(1);
    }
  });

  it("returns 1 for perfectly balanced single-day data", () => {
    // Python: [1, 1] → TS: [1]
    const [p] = sequentialPValues([[500, 500]], [0.5, 0.5]);
    expect(p).toBeCloseTo(1, 9);
  });

  it("returns a very small p-value for highly imbalanced single-day data", () => {
    // Python: [1, 8.126155715401769e-08] → TS: [8.126155715401769e-08]
    const [p] = sequentialPValues([[800, 200]], [0.5, 0.5]);
    expectRelativelyClose(p, 8.126155715401769e-8);
  });

  it("returns 1 for all balanced days in a multi-day experiment", () => {
    // Python: [1, 1, 1, 1] → TS: [1, 1, 1]
    const result = sequentialPValues(
      [
        [500, 500],
        [600, 600],
        [700, 700],
      ],
      [0.5, 0.5],
    );
    for (const p of result) {
      expect(p).toBeCloseTo(1, 9);
    }
  });

  it("accumulates evidence across days for a growing imbalance", () => {
    // Python: [1, 1, 0.207, 1.10e-6, 5.12e-23] → TS: [1, 0.207, 1.10e-6, 5.12e-23]
    const data = [
      [500, 500],
      [600, 400],
      [700, 300],
      [800, 200],
    ];
    const result = sequentialPValues(data, [0.5, 0.5]);
    expect(result).toHaveLength(4);
    expect(result[0]).toBeCloseTo(1, 9);
    expect(result[1]).toBeCloseTo(0.20685901461423034, 9);
    expectRelativelyClose(result[2], 1.099173293697608e-6);
    expectRelativelyClose(result[3], 5.115536116778213e-23);
  });

  it("p-values are monotonically non-increasing (running minimum property)", () => {
    // Alternating good/bad days: once p-value drops it cannot rise
    const data = [
      [800, 200],
      [500, 500],
      [800, 200],
      [500, 500],
    ];
    const result = sequentialPValues(data, [0.5, 0.5]);
    for (let i = 1; i < result.length; i++) {
      expect(result[i]).toBeLessThanOrEqual(result[i - 1]);
    }
  });

  it("handles a 3-way split where observed matches expected weights", () => {
    // Python: [1, 1, 1] → TS: [1, 1]
    const result = sequentialPValues(
      [
        [400, 200, 400],
        [400, 200, 400],
      ],
      [0.4, 0.2, 0.4],
    );
    expect(result).toHaveLength(2);
    for (const p of result) {
      expect(p).toBeCloseTo(1, 9);
    }
  });

  it("detects SRM in a 3-way split with a large mismatch", () => {
    // Python: [1, 1.4343631225400445e-06] → TS: [1.4343631225400445e-06]
    const [p] = sequentialPValues([[600, 200, 200]], [0.34, 0.33, 0.33]);
    expectRelativelyClose(p, 1.4343631225400445e-6);
  });

  it("treats all-zero rows as carrying no information (p-value unchanged)", () => {
    // data: [[500,500], [0,0], [600,400]]
    // Python: [1, 1, 1, 0.207] → TS: [1, 1, 0.207]
    // The zero row does not move the running minimum.
    const result = sequentialPValues(
      [
        [500, 500],
        [0, 0],
        [600, 400],
      ],
      [0.5, 0.5],
    );
    expect(result).toHaveLength(3);
    expect(result[0]).toBeCloseTo(1, 9);
    expect(result[1]).toBeCloseTo(1, 9); // [0,0] leaves p-value unchanged
    expect(result[1]).toBeCloseTo(result[0], 9);
    expect(result[2]).toBeCloseTo(0.20685901461423034, 9);
  });

  describe("with mixture prior (slabWeight > 0)", () => {
    it("produces a smaller p-value than the single-component model", () => {
      const data = [
        [800, 200],
        [800, 200],
      ];
      const mixture = sequentialPValues(data, [0.5, 0.5], { slabWeight: 0.1 });
      const standard = sequentialPValues(data, [0.5, 0.5]);
      expect(mixture[1]).toBeLessThan(standard[1]);
    });

    it("matches Python reference values with slab_weight=0.1", () => {
      // Python: [1, 6.18e-82, 1.71e-164] → TS: [6.18e-82, 1.71e-164]
      const result = sequentialPValues(
        [
          [800, 200],
          [800, 200],
        ],
        [0.5, 0.5],
        { slabWeight: 0.1 },
      );
      expect(result).toHaveLength(2);
      expectRelativelyClose(result[0], 6.181726093290075e-82);
      expectRelativelyClose(result[1], 1.7120576428173616e-164);
    });

    it("slabWeight=0 behaves identically to the default (no mixture)", () => {
      const data = [
        [800, 200],
        [600, 400],
      ];
      const withZeroSlab = sequentialPValues(data, [0.5, 0.5], {
        slabWeight: 0,
      });
      const withDefault = sequentialPValues(data, [0.5, 0.5]);
      expect(withZeroSlab).toEqual(withDefault);
    });
  });

  describe("with custom dirichletConcentration", () => {
    it("lower concentration yields a smaller (more sensitive) p-value", () => {
      // Python: concentration=100 → 2.25e-75; concentration=10000 → 8.13e-08
      const data = [[800, 200]];
      const lowConc = sequentialPValues(data, [0.5, 0.5], {
        dirichletConcentration: 100,
      });
      const highConc = sequentialPValues(data, [0.5, 0.5], {
        dirichletConcentration: 10000,
      });
      expect(lowConc[0]).toBeLessThan(highConc[0]);
      expectRelativelyClose(lowConc[0], 2.253273013435552e-75);
      expectRelativelyClose(highConc[0], 8.126155715401769e-8);
    });
  });
});

// ---------------------------------------------------------------------------
// extractSrmDailyUsers (stats.ts)
// ---------------------------------------------------------------------------

describe("extractSrmDailyUsers", () => {
  const twoVariations = [
    { id: "v0", weight: 0.5 },
    { id: "v1", weight: 0.5 },
  ];

  it("returns empty array when rows is undefined", () => {
    expect(extractSrmDailyUsers(undefined, twoVariations)).toEqual([]);
  });

  it("returns empty array when rows is empty", () => {
    expect(extractSrmDailyUsers([], twoVariations)).toEqual([]);
  });

  it("filters out rows whose dimension_name is not dim_exposure_date", () => {
    const rows = [
      {
        variation: "v0",
        dimension_name: "some_other_dim",
        dimension_value: "2024-01-01",
        units: 100,
      },
    ];
    expect(extractSrmDailyUsers(rows, twoVariations)).toEqual([]);
  });

  it("builds a correctly ordered daily matrix from exposure-date rows", () => {
    const rows = [
      // out-of-order rows — should be sorted by dimension_value
      {
        variation: "v1",
        dimension_name: "dim_exposure_date",
        dimension_value: "2024-01-02",
        units: 400,
      },
      {
        variation: "v0",
        dimension_name: "dim_exposure_date",
        dimension_value: "2024-01-01",
        units: 500,
      },
      {
        variation: "v1",
        dimension_name: "dim_exposure_date",
        dimension_value: "2024-01-01",
        units: 500,
      },
      {
        variation: "v0",
        dimension_name: "dim_exposure_date",
        dimension_value: "2024-01-02",
        units: 600,
      },
    ];
    expect(extractSrmDailyUsers(rows, twoVariations)).toEqual([
      [500, 500], // 2024-01-01 (earlier date first)
      [600, 400], // 2024-01-02
    ]);
  });

  it("skips rows with an unknown variation ID, leaving that slot as 0", () => {
    const rows = [
      {
        variation: "v0",
        dimension_name: "dim_exposure_date",
        dimension_value: "2024-01-01",
        units: 500,
      },
      {
        variation: "unknown_var",
        dimension_name: "dim_exposure_date",
        dimension_value: "2024-01-01",
        units: 100,
      },
    ];
    // v1 was never seen, so its slot stays at 0
    expect(extractSrmDailyUsers(rows, twoVariations)).toEqual([[500, 0]]);
  });

  it("handles a 3-variation setup correctly", () => {
    const threeVariations = [
      { id: "v0", weight: 0.5 },
      { id: "v1", weight: 0.25 },
      { id: "v2", weight: 0.25 },
    ];
    const rows = [
      {
        variation: "v0",
        dimension_name: "dim_exposure_date",
        dimension_value: "2024-01-01",
        units: 500,
      },
      {
        variation: "v1",
        dimension_name: "dim_exposure_date",
        dimension_value: "2024-01-01",
        units: 250,
      },
      {
        variation: "v2",
        dimension_name: "dim_exposure_date",
        dimension_value: "2024-01-01",
        units: 250,
      },
    ];
    expect(extractSrmDailyUsers(rows, threeVariations)).toEqual([
      [500, 250, 250],
    ]);
  });

  it("maps variation slots in index order, not insertion order", () => {
    // Rows arrive in reverse order of variation index
    const rows = [
      {
        variation: "v1",
        dimension_name: "dim_exposure_date",
        dimension_value: "2024-01-01",
        units: 300,
      },
      {
        variation: "v0",
        dimension_name: "dim_exposure_date",
        dimension_value: "2024-01-01",
        units: 700,
      },
    ];
    const result = extractSrmDailyUsers(rows, twoVariations);
    // v0 is index 0, v1 is index 1 regardless of row order
    expect(result).toEqual([[700, 300]]);
  });
});

// ---------------------------------------------------------------------------
// computeTrafficSrm (stats.ts)
// ---------------------------------------------------------------------------

describe("computeTrafficSrm", () => {
  const seqSettings: SrmSettings = {
    srmMethod: "sequential",
    srmSlabWeight: 0.0,
    srmDirichletConcentration: 10000,
  };

  it("uses sequential for daily data when settings specify it", () => {
    const dailyEntries = [
      { variationUnits: [800, 200] },
      { variationUnits: [800, 200] },
    ];
    const p = computeTrafficSrm(
      [1600, 400],
      dailyEntries,
      [0.5, 0.5],
      seqSettings,
    );
    expect(p).toBeLessThan(0.05);
  });

  it("wraps aggregated totals as single row for sequential when no daily data", () => {
    const pTraffic = computeTrafficSrm([800, 200], [], [0.5, 0.5], seqSettings);
    // Should still detect SRM via sequential (single-row matrix)
    expect(pTraffic).toBeLessThan(0.05);
    expect(pTraffic).toBeGreaterThanOrEqual(0);
  });

  it("uses chi-squared by default when settings omitted", () => {
    const dailyEntries = [
      { variationUnits: [500, 500] },
      { variationUnits: [500, 500] },
    ];
    const p = computeTrafficSrm([1000, 1000], dailyEntries, [0.5, 0.5]);
    expect(p).toBeCloseTo(1, 5);
  });
});

// ---------------------------------------------------------------------------
// computeDimensionSrm (stats.ts)
// ---------------------------------------------------------------------------

describe("computeDimensionSrm", () => {
  it("uses chi-squared with default settings", () => {
    const p = computeDimensionSrm([500, 500], [0.5, 0.5]);
    expect(p).toBeCloseTo(1, 5);
  });

  it("uses sequential on aggregated totals when sequential enabled", () => {
    const seqSettings: SrmSettings = {
      srmMethod: "sequential",
      srmSlabWeight: 0.0,
      srmDirichletConcentration: 10000,
    };
    // Imbalanced: sequential should detect SRM on aggregate counts
    const p = computeDimensionSrm([1600, 400], [0.5, 0.5], seqSettings);
    expect(p).toBeLessThan(0.05);
  });

  it("returns high p-value for balanced traffic with sequential", () => {
    const seqSettings: SrmSettings = {
      srmMethod: "sequential",
      srmSlabWeight: 0.0,
      srmDirichletConcentration: 10000,
    };
    const p = computeDimensionSrm([500, 500], [0.5, 0.5], seqSettings);
    expect(p).toBeGreaterThan(0.05);
  });
});

// ---------------------------------------------------------------------------
// computePerDaySequentialSrm (stats.ts)
// ---------------------------------------------------------------------------

describe("computePerDaySequentialSrm", () => {
  const seqSettings: SrmSettings = {
    srmMethod: "sequential",
    srmSlabWeight: 0.0,
    srmDirichletConcentration: 10000,
  };

  it("returns one p-value per day for sequential", () => {
    const dailyMatrix = [
      [500, 500],
      [600, 400],
      [700, 300],
    ];
    const pValues = computePerDaySequentialSrm(
      dailyMatrix,
      [0.5, 0.5],
      seqSettings,
    );
    expect(pValues).toHaveLength(3);
  });

  it("p-values are monotonically non-increasing (running minimum)", () => {
    const dailyMatrix = [
      [800, 200],
      [500, 500],
      [800, 200],
    ];
    const pValues = computePerDaySequentialSrm(
      dailyMatrix,
      [0.5, 0.5],
      seqSettings,
    );
    for (let i = 1; i < pValues.length; i++) {
      expect(pValues[i]).toBeLessThanOrEqual(pValues[i - 1]);
    }
  });

  it("balanced traffic yields high p-values across all days", () => {
    const dailyMatrix = [
      [500, 500],
      [500, 500],
      [500, 500],
    ];
    const pValues = computePerDaySequentialSrm(
      dailyMatrix,
      [0.5, 0.5],
      seqSettings,
    );
    for (const p of pValues) {
      expect(p).toBeGreaterThan(0.05);
    }
  });

  it("falls back to per-day chi-squared when method is chi_squared", () => {
    const chiSettings: SrmSettings = {
      srmMethod: "chi_squared",
      srmSlabWeight: 0.0,
      srmDirichletConcentration: 10000,
    };
    const dailyMatrix = [
      [500, 500],
      [800, 200],
    ];
    const pValues = computePerDaySequentialSrm(
      dailyMatrix,
      [0.5, 0.5],
      chiSettings,
    );
    expect(pValues).toHaveLength(2);
    // Each day computed independently — balanced day has high p, imbalanced has low p
    expect(pValues[0]).toBeGreaterThan(0.05);
    expect(pValues[1]).toBeLessThan(0.05);
  });

  it("returns empty array for empty input", () => {
    const pValues = computePerDaySequentialSrm([], [0.5, 0.5], seqSettings);
    expect(pValues).toEqual([]);
  });
});
