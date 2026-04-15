import {
  ExperimentSnapshotAnalysis,
  ExperimentSnapshotAnalysisSettings,
  ExperimentSnapshotInterface,
  SnapshotMetric,
} from "shared/types/experiment-snapshot";
import {
  encodeSnapshotAnalysisChunks,
  decodeSnapshotAnalysisChunks,
  buildMetricOrdering,
  getChunkedAnalysesMetaFromSnapshot,
  AnalysisMetaEntry,
} from "../src/snapshot-analysis-chunks";
import {
  experimentSnapshotAnalysisChunkValidator,
  validateExperimentSnapshotAnalysisChunkColumnLengths,
} from "../src/validators/snapshot-analysis-chunks";

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
    numGoalMetrics: 0,
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

function decodeHelper(
  analyses: ExperimentSnapshotAnalysis[],
  filterMetricIds?: Set<string>,
) {
  const { metricChunks, chunkedAnalysesMeta } = encodeSnapshotAnalysisChunks(
    analyses,
    [],
  );
  const chunks = Array.from(metricChunks.entries()).map(
    ([metricId, chunk]) => ({ metricId, ...chunk }),
  );
  const analysisMetadata = analyses.map((a) => ({
    settings: a.settings,
    dateCreated: a.dateCreated,
    status: a.status as "success" | "running" | "error",
    ...(a.error ? { error: a.error } : {}),
  }));
  return decodeSnapshotAnalysisChunks(
    chunks,
    chunkedAnalysesMeta,
    analysisMetadata,
    filterMetricIds,
  );
}

function makeExperimentSnapshotAnalysisChunk(data: Record<string, unknown[]>) {
  return {
    organization: "org_1",
    dateCreated: new Date("2025-01-01"),
    dateUpdated: new Date("2025-01-01"),
    id: "snpana_1",
    snapshotId: "snp_1",
    experimentId: "exp_1",
    metricId: "met_1",
    numRows: 2,
    data,
  };
}

describe("experimentSnapshotAnalysisChunkValidator", () => {
  it("accepts column data when all arrays match numRows", () => {
    const result = experimentSnapshotAnalysisChunkValidator.safeParse(
      makeExperimentSnapshotAnalysisChunk({
        a: [0, 0],
        d: ["All", "All"],
        v: [0, 1],
        value: [0.1, 0.2],
      }),
    );

    expect(result.success).toBe(true);
  });

  it("rejects column data when any array length differs from the other columns", () => {
    const result = experimentSnapshotAnalysisChunkValidator.safeParse(
      makeExperimentSnapshotAnalysisChunk({
        a: [0, 0],
        d: ["All"],
        v: [0, 1],
        value: [0.1, 0.2, 0.3],
      }),
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            message: 'Column "d" has 1 rows, expected 2',
            path: ["data", "d"],
          }),
          expect.objectContaining({
            message: 'Column "value" has 3 rows, expected 2',
            path: ["data", "value"],
          }),
        ]),
      );
    }
  });

  it("rejects column data when numRows does not match the common array length", () => {
    const result = experimentSnapshotAnalysisChunkValidator.safeParse({
      ...makeExperimentSnapshotAnalysisChunk({
        a: [0, 0],
        d: ["All", "All"],
        v: [0, 1],
      }),
      numRows: 3,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            message: "numRows has 3 rows, expected 2",
            path: ["numRows"],
          }),
        ]),
      );
    }
  });

  it("throws from the model-layer helper when column lengths are invalid", () => {
    expect(() =>
      validateExperimentSnapshotAnalysisChunkColumnLengths({
        numRows: 2,
        data: {
          a: [0, 0],
          d: ["All"],
          v: [0, 1],
        },
      }),
    ).toThrow(
      "Snapshot analysis chunk columns must have the same length and match numRows",
    );
  });
});

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

describe("encodeSnapshotAnalysisChunks", () => {
  it("produces one chunk per metric", () => {
    const analyses = [
      makeAnalysis([
        {
          name: "All",
          srm: 0.5,
          variations: [
            {
              users: 500,
              metrics: {
                met_a: makeMetric({ value: 1 }),
                met_b: makeMetric({ value: 2 }),
              },
            },
            {
              users: 500,
              metrics: {
                met_a: makeMetric({ value: 3 }),
                met_b: makeMetric({ value: 4 }),
              },
            },
          ],
        },
      ]),
    ];

    const { metricChunks } = encodeSnapshotAnalysisChunks(analyses, [
      "met_a",
      "met_b",
    ]);

    expect(metricChunks.size).toBe(2);
    expect(metricChunks.has("met_a")).toBe(true);
    expect(metricChunks.has("met_b")).toBe(true);

    // Each metric has 2 rows (2 variations)
    expect(metricChunks.get("met_a")!.numRows).toBe(2);
    expect(metricChunks.get("met_b")!.numRows).toBe(2);

    // No "m" column in data (metricId is document-level)
    expect(metricChunks.get("met_a")!.data.m).toBeUndefined();
  });

  it("extracts chunkedAnalysesMeta correctly", () => {
    const analyses = [
      makeAnalysis([
        {
          name: "All",
          srm: 0.5,
          variations: [
            { users: 500, metrics: { met_1: makeMetric() } },
            { users: 600, metrics: { met_1: makeMetric() } },
          ],
        },
        {
          name: "country:US",
          srm: 0.48,
          variations: [
            { users: 200, metrics: { met_1: makeMetric() } },
            { users: 300, metrics: { met_1: makeMetric() } },
          ],
        },
      ]),
    ];

    const { chunkedAnalysesMeta } = encodeSnapshotAnalysisChunks(analyses, [
      "met_1",
    ]);

    expect(chunkedAnalysesMeta).toHaveLength(1);
    expect(chunkedAnalysesMeta[0].dimensions).toHaveLength(2);
    expect(chunkedAnalysesMeta[0].dimensions[0]).toEqual({
      name: "All",
      srm: 0.5,
      variationUsers: [500, 600],
    });
    expect(chunkedAnalysesMeta[0].dimensions[1]).toEqual({
      name: "country:US",
      srm: 0.48,
      variationUsers: [200, 300],
    });
  });

  it("handles empty results", () => {
    const analyses = [makeAnalysis([])];
    const { metricChunks, chunkedAnalysesMeta } = encodeSnapshotAnalysisChunks(
      analyses,
      [],
    );
    expect(metricChunks.size).toBe(0);
    expect(chunkedAnalysesMeta).toHaveLength(1);
    expect(chunkedAnalysesMeta[0].dimensions).toHaveLength(0);
  });
});

describe("decodeSnapshotAnalysisChunks", () => {
  it("round-trips a simple case", () => {
    const analyses = [
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

    const decoded = decodeHelper(analyses);
    expect(decoded).toHaveLength(1);
    expect(decoded[0].results).toHaveLength(1);
    expect(decoded[0].results[0].name).toBe("All");
    expect(decoded[0].results[0].srm).toBe(0.5);
    expect(decoded[0].results[0].variations).toHaveLength(2);
    expect(decoded[0].results[0].variations[0].users).toBe(500);
    expect(decoded[0].results[0].variations[0].metrics.met_1.value).toBe(0.5);
    expect(decoded[0].results[0].variations[1].metrics.met_1.value).toBe(0.6);
  });

  it("round-trips complex SnapshotMetric fields", () => {
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

    const decoded = decodeHelper(analyses);
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
            { users: 50, metrics: { met_a: makeMetric({ value: 5 }) } },
            { users: 50, metrics: { met_a: makeMetric({ value: 6 }) } },
          ],
        },
      ]),
      makeAnalysis(
        [
          {
            name: "All",
            srm: 0.51,
            variations: [
              { users: 200, metrics: { met_a: makeMetric({ value: 7 }) } },
              { users: 200, metrics: { met_a: makeMetric({ value: 8 }) } },
            ],
          },
        ],
        { statsEngine: "frequentist" },
      ),
    ];

    const decoded = decodeHelper(analyses);

    // Analysis 0
    expect(decoded[0].settings.statsEngine).toBe("bayesian");
    expect(decoded[0].results).toHaveLength(2);

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

  it("creates one chunk per metric for large datasets", () => {
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
    const { metricChunks } = encodeSnapshotAnalysisChunks(
      analyses,
      metricOrdering,
    );

    // 1 chunk per metric
    expect(metricChunks.size).toBe(50);

    // Round-trip decode
    const decoded = decodeHelper(analyses);
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

    const decoded = decodeHelper(analyses);
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

    const decoded = decodeHelper(analyses);
    const result = decoded[0].results[0].variations[0].metrics.met_1;
    expect(result.value).toBe(1);
    expect(result.cr).toBe(0.5);
    expect(result.users).toBe(100);
    expect(result.denominator).toBeUndefined();
    expect(result.ci).toBeUndefined();
    expect(result.stats).toBeUndefined();
    expect(result.uplift).toBeUndefined();
    expect(result.buckets).toBeUndefined();
  });

  it("treats top-level CI nulls as absent and preserves unbounded CIs", () => {
    const analysisMetadata = [
      {
        settings: makeAnalysisSettings(),
        dateCreated: new Date("2025-01-01"),
        status: "success" as const,
      },
    ];
    const chunkedAnalysesMeta: AnalysisMetaEntry[] = [
      {
        dimensions: [
          {
            name: "All",
            srm: 0.5,
            variationUsers: [100, 100, 100, 100, 100],
          },
        ],
      },
    ];
    const decoded = decodeSnapshotAnalysisChunks(
      [
        {
          metricId: "met_1",
          numRows: 5,
          data: {
            a: [0, 0, 0, 0, 0],
            d: ["All", "All", "All", "All", "All"],
            v: [0, 1, 2, 3, 4],
            value: [1, 2, 3, 4, 5],
            cr: [0.1, 0.2, 0.3, 0.4, 0.5],
            users: [100, 100, 100, 100, 100],
            ci: [
              null,
              undefined,
              [-Infinity, 0.2],
              [0.1, Infinity],
              [-Infinity, Infinity],
            ],
            ciAdjusted: [
              null,
              undefined,
              [-Infinity, 0.3],
              [0.2, Infinity],
              [-Infinity, Infinity],
            ],
          },
        },
      ],
      chunkedAnalysesMeta,
      analysisMetadata,
    );

    const metrics = decoded[0].results[0].variations.map(
      (v) => v.metrics.met_1,
    );
    expect(metrics[0].ci).toBeUndefined();
    expect(metrics[0].ciAdjusted).toBeUndefined();
    expect(metrics[1].ci).toBeUndefined();
    expect(metrics[1].ciAdjusted).toBeUndefined();
    expect(metrics[2].ci).toEqual([-Infinity, 0.2]);
    expect(metrics[2].ciAdjusted).toEqual([-Infinity, 0.3]);
    expect(metrics[3].ci).toEqual([0.1, Infinity]);
    expect(metrics[3].ciAdjusted).toEqual([0.2, Infinity]);
    expect(metrics[4].ci).toEqual([-Infinity, Infinity]);
    expect(metrics[4].ciAdjusted).toEqual([-Infinity, Infinity]);
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

    const decoded = decodeHelper(analyses, new Set(["met_a", "met_c"]));
    const metrics0 = decoded[0].results[0].variations[0].metrics;
    expect(metrics0.met_a.value).toBe(1);
    expect(metrics0.met_c.value).toBe(3);
    expect(metrics0.met_b).toBeUndefined();
  });

  it("preserves analysis error field", () => {
    const analysisMetadata = [
      {
        settings: makeAnalysisSettings(),
        dateCreated: new Date("2025-01-01"),
        status: "error" as const,
        error: "Something went wrong",
      },
    ];
    const chunkedAnalysesMeta: AnalysisMetaEntry[] = [{ dimensions: [] }];

    const decoded = decodeSnapshotAnalysisChunks(
      [],
      chunkedAnalysesMeta,
      analysisMetadata,
    );
    expect(decoded[0].status).toBe("error");
    expect(decoded[0].error).toBe("Something went wrong");
  });

  it("chunked path produces the same result as the original inline path", () => {
    const richMetric: SnapshotMetric = {
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

    const minimalMetric: SnapshotMetric = {
      value: 1,
      cr: 0.5,
      users: 100,
    };

    const analyses: ExperimentSnapshotAnalysis[] = [
      makeAnalysis(
        [
          {
            name: "All",
            srm: 0.5,
            variations: [
              {
                users: 2000,
                metrics: {
                  met_goal: richMetric,
                  met_secondary: makeMetric({ value: 10, ci: [8, 12] }),
                  met_guardrail: minimalMetric,
                },
              },
              {
                users: 2100,
                metrics: {
                  met_goal: makeMetric({
                    value: 0.55,
                    cr: 0.18,
                    users: 2100,
                    uplift: { dist: "normal", mean: 0.13, stddev: 0.05 },
                    chanceToWin: 0.92,
                    pValue: 0.01,
                  }),
                  met_secondary: makeMetric({ value: 11, ci: [9, 13] }),
                  met_guardrail: makeMetric({ value: 2, cr: 0.6, users: 200 }),
                },
              },
              {
                users: 1900,
                metrics: {
                  met_goal: makeMetric({ value: 0.38, cr: 0.11, users: 1900 }),
                  met_secondary: makeMetric({ value: 9 }),
                  met_guardrail: minimalMetric,
                },
              },
            ],
          },
          {
            name: "country:US",
            srm: 0.48,
            variations: [
              {
                users: 800,
                metrics: {
                  met_goal: makeMetric({ value: 0.5, cr: 0.14, users: 800 }),
                },
              },
              {
                users: 850,
                metrics: {
                  met_goal: makeMetric({ value: 0.6, cr: 0.19, users: 850 }),
                },
              },
              {
                users: 750,
                metrics: {
                  met_goal: makeMetric({ value: 0.35, cr: 0.1, users: 750 }),
                },
              },
            ],
          },
          {
            name: "country:UK",
            srm: 0.52,
            variations: [
              {
                users: 400,
                metrics: {
                  met_goal: makeMetric({ value: 0.45, cr: 0.13, users: 400 }),
                  met_secondary: makeMetric({ value: 12 }),
                },
              },
              {
                users: 420,
                metrics: {
                  met_goal: makeMetric({ value: 0.58, cr: 0.17, users: 420 }),
                  met_secondary: makeMetric({ value: 14 }),
                },
              },
              {
                users: 380,
                metrics: {
                  met_goal: makeMetric({ value: 0.4, cr: 0.12, users: 380 }),
                  met_secondary: makeMetric({ value: 10 }),
                },
              },
            ],
          },
        ],
        { statsEngine: "bayesian", numGoalMetrics: 1 },
      ),
      makeAnalysis(
        [
          {
            name: "All",
            srm: 0.51,
            variations: [
              {
                users: 2000,
                metrics: {
                  met_goal: makeMetric({
                    value: 0.42,
                    cr: 0.15,
                    users: 2000,
                    pValue: 0.04,
                    pValueAdjusted: 0.08,
                  }),
                  met_secondary: makeMetric({ value: 10 }),
                },
              },
              {
                users: 2100,
                metrics: {
                  met_goal: makeMetric({
                    value: 0.55,
                    cr: 0.18,
                    users: 2100,
                    pValue: 0.01,
                    pValueAdjusted: 0.02,
                  }),
                  met_secondary: makeMetric({ value: 11 }),
                },
              },
              {
                users: 1900,
                metrics: {
                  met_goal: makeMetric({
                    value: 0.38,
                    cr: 0.11,
                    users: 1900,
                    pValue: 0.15,
                  }),
                  met_secondary: makeMetric({ value: 9 }),
                },
              },
            ],
          },
        ],
        {
          statsEngine: "frequentist",
          sequentialTesting: true,
          differenceType: "absolute",
          numGoalMetrics: 1,
        },
      ),
    ];

    // --- Original path: analyses are stored inline on the snapshot ---
    const originalPathResult = analyses;

    // --- Chunked path: simulate what the production code does ---
    // 1. Build a snapshot object as it would exist in the DB
    const snapshot = {
      id: "snp_test123",
      organization: "org_test",
      experiment: "exp_test",
      phase: 0,
      dimension: null,
      dateCreated: new Date("2025-01-01"),
      runStarted: new Date("2025-01-01"),
      status: "success" as const,
      settings: {
        dimensions: [],
        metricSettings: [],
        goalMetrics: ["met_goal"],
        secondaryMetrics: ["met_secondary"],
        guardrailMetrics: ["met_guardrail"],
        activationMetric: null,
        defaultMetricPriorSettings: {
          override: false,
          proper: false,
          mean: 0,
          stddev: 0.3,
        },
        regressionAdjustmentEnabled: false,
        attributionModel: "firstExposure" as const,
        experimentId: "exp_test",
        queryFilter: "",
        segment: "",
        skipPartialData: false,
        datasourceId: "ds_test",
        exposureQueryId: "eq_test",
        startDate: new Date("2025-01-01"),
        endDate: new Date("2025-02-01"),
        variations: [
          { id: "0", weight: 0.34 },
          { id: "1", weight: 0.33 },
          { id: "2", weight: 0.33 },
        ],
      },
      queries: [],
      unknownVariations: [],
      multipleExposures: 0,
      // Analyses stored with results for getChunkedAnalysesMetaFromSnapshot
      analyses,
      hasChunkedAnalyses: true,
    } satisfies ExperimentSnapshotInterface;

    // 2. Encode: what createFromAnalyses does
    const metricOrdering = buildMetricOrdering(
      snapshot.settings.goalMetrics,
      snapshot.settings.secondaryMetrics,
      snapshot.settings.guardrailMetrics,
    );
    const { metricChunks, chunkedAnalysesMeta } = encodeSnapshotAnalysisChunks(
      analyses,
      metricOrdering,
    );

    // 3. Simulate the snapshot as stored in DB (analyses have empty results,
    //    chunkedAnalysesMeta is saved alongside)
    const storedSnapshot: ExperimentSnapshotInterface = {
      ...snapshot,
      analyses: analyses.map((a) => ({ ...a, results: [] })),
      chunkedAnalysesMeta,
    };

    // 4. Decode: what populateChunkedAnalyses does via getChunkedAnalysesMetaFromSnapshot
    const { chunkedAnalysesMeta: decodeMeta, analysisMetadata } =
      getChunkedAnalysesMetaFromSnapshot(storedSnapshot);
    const chunks = Array.from(metricChunks.entries()).map(
      ([metricId, chunk]) => ({ metricId, ...chunk }),
    );
    const chunkedPathResult = decodeSnapshotAnalysisChunks(
      chunks,
      decodeMeta,
      analysisMetadata,
    );

    // --- The two paths must produce identical analyses ---
    expect(chunkedPathResult).toEqual(originalPathResult);
  });

  it("handles metrics not in the ordering", () => {
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

    const { metricChunks } = encodeSnapshotAnalysisChunks(analyses, [
      "met_known",
    ]);
    expect(metricChunks.has("met_known")).toBe(true);
    expect(metricChunks.has("met_unknown")).toBe(true);

    const decoded = decodeHelper(analyses);
    expect(decoded[0].results[0].variations[0].metrics.met_known.value).toBe(1);
    expect(decoded[0].results[0].variations[0].metrics.met_unknown.value).toBe(
      2,
    );
  });
});
