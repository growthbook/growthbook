import {
  ExperimentSnapshotAnalysis,
  ExperimentSnapshotAnalysisSettings,
  SnapshotMetric,
} from "shared/types/experiment-snapshot";
import {
  encodeSnapshotResults,
  decodeSnapshotResults,
  buildMetricOrdering,
} from "../src/snapshot-results";

function makeMetric(overrides: Partial<SnapshotMetric> = {}): SnapshotMetric {
  return {
    value: 0.5,
    cr: 0.1,
    users: 1000,
    ...overrides,
  };
}

function makeAnalysisSettings(
  overrides: Partial<ExperimentSnapshotAnalysisSettings> = {},
): ExperimentSnapshotAnalysisSettings {
  return {
    dimensions: [],
    statsEngine: "bayesian",
    regressionAdjusted: false,
    sequentialTesting: false,
    baselineVariationIndex: 0,
    differenceType: "relative",
    pValueCorrection: null,
    ...overrides,
  };
}

function makeAnalysis(
  results: ExperimentSnapshotAnalysis["results"],
  settingsOverrides: Partial<ExperimentSnapshotAnalysisSettings> = {},
): ExperimentSnapshotAnalysis {
  return {
    settings: makeAnalysisSettings(settingsOverrides),
    dateCreated: new Date("2025-01-01"),
    status: "success",
    results,
  };
}

describe("buildMetricOrdering", () => {
  it("should order goals, secondary, guardrails", () => {
    const result = buildMetricOrdering(["g1", "g2"], ["s1"], ["gd1"]);
    expect(result).toEqual(["g1", "g2", "s1", "gd1"]);
  });

  it("should deduplicate metric IDs", () => {
    const result = buildMetricOrdering(["m1", "m2"], ["m2", "m3"], ["m1"]);
    expect(result).toEqual(["m1", "m2", "m3"]);
  });

  it("should put slice metrics (containing ?) last", () => {
    const result = buildMetricOrdering(
      ["g1", "g1?col=chrome"],
      ["s1"],
      ["gd1", "gd1?col=safari"],
    );
    expect(result).toEqual([
      "g1",
      "s1",
      "gd1",
      "g1?col=chrome",
      "gd1?col=safari",
    ]);
  });

  it("should handle empty arrays", () => {
    const result = buildMetricOrdering([], [], []);
    expect(result).toEqual([]);
  });
});

describe("encodeSnapshotResults / decodeSnapshotResults", () => {
  it("round-trips a simple case with one analysis, one dimension, two variations, one metric", () => {
    const analyses: ExperimentSnapshotAnalysis[] = [
      makeAnalysis([
        {
          name: "All",
          srm: 0.5,
          variations: [
            {
              users: 500,
              metrics: {
                met_1: makeMetric({ value: 0.5, cr: 0.1, users: 500 }),
              },
            },
            {
              users: 500,
              metrics: {
                met_1: makeMetric({ value: 0.6, cr: 0.12, users: 500 }),
              },
            },
          ],
        },
      ]),
    ];

    const { chunks, metricIdsByChunk } = encodeSnapshotResults(analyses, [
      "met_1",
    ]);

    expect(chunks).toHaveLength(1);
    expect(metricIdsByChunk).toEqual([["met_1"]]);
    expect(chunks[0].numRows).toBe(2); // 2 variations

    const metadata = analyses.map((a) => ({
      settings: a.settings,
      dateCreated: a.dateCreated,
      status: a.status as "success",
    }));

    const decoded = decodeSnapshotResults(chunks, metadata);
    expect(decoded).toHaveLength(1);
    expect(decoded[0].results).toHaveLength(1);
    expect(decoded[0].results[0].name).toBe("All");
    expect(decoded[0].results[0].srm).toBe(0.5);
    expect(decoded[0].results[0].variations).toHaveLength(2);
    expect(decoded[0].results[0].variations[0].users).toBe(500);
    expect(decoded[0].results[0].variations[0].metrics.met_1.value).toBe(0.5);
    expect(decoded[0].results[0].variations[1].metrics.met_1.value).toBe(0.6);
  });

  it("round-trips complex SnapshotMetric fields (ci, risk, stats, uplift, buckets, etc.)", () => {
    const metric: SnapshotMetric = {
      value: 0.42,
      cr: 0.15,
      users: 2000,
      denominator: 1800,
      ci: [-0.05, 0.15],
      ciAdjusted: [-0.03, 0.13],
      expected: 0.08,
      risk: [0.01, 0.02],
      riskType: "relative",
      pValue: 0.03,
      pValueAdjusted: 0.06,
      chanceToWin: 0.85,
      stats: { users: 2000, mean: 0.42, count: 2000, stddev: 0.12 },
      uplift: { dist: "lognormal", mean: 0.08, stddev: 0.04 },
      errorMessage: "Some warning",
      buckets: [
        { x: 0, y: 10 },
        { x: 1, y: 20 },
      ],
    };

    const analyses = [
      makeAnalysis([
        {
          name: "All",
          srm: 0.5,
          variations: [
            { users: 2000, metrics: { met_1: metric } },
            { users: 2000, metrics: { met_1: makeMetric() } },
          ],
        },
      ]),
    ];

    const { chunks } = encodeSnapshotResults(analyses, ["met_1"]);
    const decoded = decodeSnapshotResults(
      chunks,
      analyses.map((a) => ({
        settings: a.settings,
        dateCreated: a.dateCreated,
        status: a.status as "success",
      })),
    );

    const result = decoded[0].results[0].variations[0].metrics.met_1;
    expect(result.value).toBe(0.42);
    expect(result.cr).toBe(0.15);
    expect(result.users).toBe(2000);
    expect(result.denominator).toBe(1800);
    expect(result.ci).toEqual([-0.05, 0.15]);
    expect(result.ciAdjusted).toEqual([-0.03, 0.13]);
    expect(result.expected).toBe(0.08);
    expect(result.risk).toEqual([0.01, 0.02]);
    expect(result.riskType).toBe("relative");
    expect(result.pValue).toBe(0.03);
    expect(result.pValueAdjusted).toBe(0.06);
    expect(result.chanceToWin).toBe(0.85);
    expect(result.stats).toEqual({
      users: 2000,
      mean: 0.42,
      count: 2000,
      stddev: 0.12,
    });
    expect(result.uplift).toEqual({
      dist: "lognormal",
      mean: 0.08,
      stddev: 0.04,
    });
    expect(result.errorMessage).toBe("Some warning");
    expect(result.buckets).toEqual([
      { x: 0, y: 10 },
      { x: 1, y: 20 },
    ]);
  });

  it("round-trips multiple analyses, dimensions, and metrics", () => {
    const analyses: ExperimentSnapshotAnalysis[] = [
      makeAnalysis([
        {
          name: "All",
          srm: 0.5,
          variations: [
            {
              users: 100,
              metrics: {
                met_a: makeMetric({ value: 1 }),
                met_b: makeMetric({ value: 2 }),
              },
            },
            {
              users: 100,
              metrics: {
                met_a: makeMetric({ value: 3 }),
                met_b: makeMetric({ value: 4 }),
              },
            },
          ],
        },
        {
          name: "country:US",
          srm: 0.48,
          variations: [
            {
              users: 50,
              metrics: { met_a: makeMetric({ value: 5 }) },
            },
            {
              users: 50,
              metrics: { met_a: makeMetric({ value: 6 }) },
            },
          ],
        },
      ]),
      makeAnalysis(
        [
          {
            name: "All",
            srm: 0.51,
            variations: [
              {
                users: 200,
                metrics: { met_a: makeMetric({ value: 7 }) },
              },
              {
                users: 200,
                metrics: { met_a: makeMetric({ value: 8 }) },
              },
            ],
          },
        ],
        { statsEngine: "frequentist" },
      ),
    ];

    const { chunks } = encodeSnapshotResults(analyses, ["met_a", "met_b"]);
    const metadata = analyses.map((a) => ({
      settings: a.settings,
      dateCreated: a.dateCreated,
      status: a.status as "success",
    }));
    const decoded = decodeSnapshotResults(chunks, metadata);

    // Analysis 0
    expect(decoded[0].settings.statsEngine).toBe("bayesian");
    expect(decoded[0].results).toHaveLength(2); // All + country:US

    const allDim = decoded[0].results.find((r) => r.name === "All")!;
    expect(allDim.srm).toBe(0.5);
    expect(allDim.variations[0].metrics.met_a.value).toBe(1);
    expect(allDim.variations[0].metrics.met_b.value).toBe(2);
    expect(allDim.variations[1].metrics.met_a.value).toBe(3);

    const usDim = decoded[0].results.find((r) => r.name === "country:US")!;
    expect(usDim.srm).toBe(0.48);
    expect(usDim.variations[0].users).toBe(50);
    expect(usDim.variations[0].metrics.met_a.value).toBe(5);

    // Analysis 1
    expect(decoded[1].settings.statsEngine).toBe("frequentist");
    expect(decoded[1].results).toHaveLength(1);
    expect(decoded[1].results[0].variations[0].metrics.met_a.value).toBe(7);
  });

  it("splits data into multiple chunks when exceeding size limit", () => {
    // Create a large dataset that will exceed a very small chunk size
    const metrics: Record<string, SnapshotMetric> = {};
    for (let i = 0; i < 50; i++) {
      metrics[`met_${i}`] = makeMetric({
        value: i,
        cr: i / 100,
        users: i * 10,
        ci: [-i, i],
        stats: { users: i * 10, mean: i, count: i * 10, stddev: i / 10 },
      });
    }

    const analyses = [
      makeAnalysis([
        {
          name: "All",
          srm: 0.5,
          variations: [
            { users: 1000, metrics },
            { users: 1000, metrics },
          ],
        },
      ]),
    ];

    const metricOrdering = Array.from({ length: 50 }, (_, i) => `met_${i}`);

    // Use a very small chunk size to force multiple chunks
    const { chunks, metricIdsByChunk } = encodeSnapshotResults(
      analyses,
      metricOrdering,
      500, // very small chunk size
    );

    expect(chunks.length).toBeGreaterThan(1);
    expect(metricIdsByChunk.length).toBe(chunks.length);

    // All metrics should be accounted for across chunks
    const allMetricIds = metricIdsByChunk.flat();
    expect(new Set(allMetricIds).size).toBe(50);

    // Round-trip decode
    const metadata = analyses.map((a) => ({
      settings: a.settings,
      dateCreated: a.dateCreated,
      status: a.status as "success",
    }));
    const decoded = decodeSnapshotResults(chunks, metadata);
    expect(decoded).toHaveLength(1);
    expect(decoded[0].results).toHaveLength(1);
    expect(
      Object.keys(decoded[0].results[0].variations[0].metrics),
    ).toHaveLength(50);
    expect(decoded[0].results[0].variations[0].metrics.met_0.value).toBe(0);
    expect(decoded[0].results[0].variations[0].metrics.met_49.value).toBe(49);
  });

  it("handles empty results gracefully", () => {
    const analyses = [makeAnalysis([])];

    const { chunks, metricIdsByChunk } = encodeSnapshotResults(analyses, []);
    expect(chunks).toHaveLength(0);
    expect(metricIdsByChunk).toHaveLength(0);

    const decoded = decodeSnapshotResults(
      [],
      [
        {
          settings: analyses[0].settings,
          dateCreated: analyses[0].dateCreated,
          status: "success",
        },
      ],
    );
    expect(decoded).toHaveLength(1);
    expect(decoded[0].results).toHaveLength(0);
  });

  it("handles optional fields being absent", () => {
    const minimalMetric: SnapshotMetric = {
      value: 1,
      cr: 0.5,
      users: 100,
    };

    const analyses = [
      makeAnalysis([
        {
          name: "All",
          srm: 0.5,
          variations: [{ users: 100, metrics: { met_1: minimalMetric } }],
        },
      ]),
    ];

    const { chunks } = encodeSnapshotResults(analyses, ["met_1"]);
    const decoded = decodeSnapshotResults(chunks, [
      {
        settings: analyses[0].settings,
        dateCreated: analyses[0].dateCreated,
        status: "success",
      },
    ]);

    const result = decoded[0].results[0].variations[0].metrics.met_1;
    expect(result.value).toBe(1);
    expect(result.cr).toBe(0.5);
    expect(result.users).toBe(100);
    // Optional fields should be absent (not null)
    expect(result.denominator).toBeUndefined();
    expect(result.ci).toBeUndefined();
    expect(result.stats).toBeUndefined();
    expect(result.uplift).toBeUndefined();
    expect(result.buckets).toBeUndefined();
  });

  it("supports partial metric filtering on decode", () => {
    const analyses = [
      makeAnalysis([
        {
          name: "All",
          srm: 0.5,
          variations: [
            {
              users: 100,
              metrics: {
                met_a: makeMetric({ value: 1 }),
                met_b: makeMetric({ value: 2 }),
                met_c: makeMetric({ value: 3 }),
              },
            },
            {
              users: 100,
              metrics: {
                met_a: makeMetric({ value: 4 }),
                met_b: makeMetric({ value: 5 }),
                met_c: makeMetric({ value: 6 }),
              },
            },
          ],
        },
      ]),
    ];

    const { chunks } = encodeSnapshotResults(analyses, [
      "met_a",
      "met_b",
      "met_c",
    ]);

    // Only decode met_a and met_c
    const decoded = decodeSnapshotResults(
      chunks,
      [
        {
          settings: analyses[0].settings,
          dateCreated: analyses[0].dateCreated,
          status: "success",
        },
      ],
      new Set(["met_a", "met_c"]),
    );

    const metrics0 = decoded[0].results[0].variations[0].metrics;
    expect(metrics0.met_a.value).toBe(1);
    expect(metrics0.met_c.value).toBe(3);
    expect(metrics0.met_b).toBeUndefined();
  });

  it("preserves analysis error field", () => {
    const analyses = [
      {
        ...makeAnalysis([]),
        status: "error" as const,
        error: "Something went wrong",
      },
    ];

    const decoded = decodeSnapshotResults(
      [],
      [
        {
          settings: analyses[0].settings,
          dateCreated: analyses[0].dateCreated,
          status: "error",
          error: "Something went wrong",
        },
      ],
    );

    expect(decoded[0].status).toBe("error");
    expect(decoded[0].error).toBe("Something went wrong");
  });

  it("handles metrics not in the ordering (appended after ordered ones)", () => {
    const analyses = [
      makeAnalysis([
        {
          name: "All",
          srm: 0.5,
          variations: [
            {
              users: 100,
              metrics: {
                met_known: makeMetric({ value: 1 }),
                met_unknown: makeMetric({ value: 2 }),
              },
            },
          ],
        },
      ]),
    ];

    // Only met_known is in the ordering
    const { chunks, metricIdsByChunk } = encodeSnapshotResults(analyses, [
      "met_known",
    ]);

    const allMetrics = metricIdsByChunk.flat();
    expect(allMetrics).toContain("met_known");
    expect(allMetrics).toContain("met_unknown");

    // met_known should appear before met_unknown
    expect(allMetrics.indexOf("met_known")).toBeLessThan(
      allMetrics.indexOf("met_unknown"),
    );

    const decoded = decodeSnapshotResults(chunks, [
      {
        settings: analyses[0].settings,
        dateCreated: analyses[0].dateCreated,
        status: "success",
      },
    ]);
    expect(decoded[0].results[0].variations[0].metrics.met_known.value).toBe(1);
    expect(decoded[0].results[0].variations[0].metrics.met_unknown.value).toBe(
      2,
    );
  });
});
