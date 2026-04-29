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
  buildAnalysisKey,
  migrateLegacySnapshotAnalysisChunkData,
  remapChunkDataPositionKeysToAnalysisKeys,
  AnalysisMetaEntry,
  MetricChunkData,
  AnalysisChunkData,
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
  analysisKey: string = buildAnalysisKey(),
): ExperimentSnapshotAnalysis {
  return {
    analysisKey,
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
  const chunks = Array.from(metricChunks.entries()).map(([metricId, data]) => ({
    metricId,
    data,
  }));
  const analysisMetadata = analyses.map((a) => ({
    analysisKey: a.analysisKey,
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

function makeExperimentSnapshotAnalysisChunk(
  data: Record<string, AnalysisChunkData>,
) {
  return {
    organization: "org_1",
    dateCreated: new Date("2025-01-01"),
    dateUpdated: new Date("2025-01-01"),
    id: "snpana_1",
    snapshotId: "snp_1",
    experimentId: "exp_1",
    metricId: "met_1",
    data,
  };
}

describe("experimentSnapshotAnalysisChunkValidator", () => {
  it("accepts per-analysis data when all column arrays match numRows", () => {
    const result = experimentSnapshotAnalysisChunkValidator.safeParse(
      makeExperimentSnapshotAnalysisChunk({
        analysisOne: {
          numRows: 2,
          d: ["All", "All"],
          v: [0, 1],
          value: [0.1, 0.2],
        },
      }),
    );

    expect(result.success).toBe(true);
  });

  it("accepts multiple analysis sub-paths in a single chunk", () => {
    const result = experimentSnapshotAnalysisChunkValidator.safeParse(
      makeExperimentSnapshotAnalysisChunk({
        analysisOne: {
          numRows: 2,
          d: ["All", "All"],
          v: [0, 1],
          value: [0.1, 0.2],
        },
        analysisTwo: {
          numRows: 1,
          d: ["All"],
          v: [0],
          value: [0.3],
        },
      }),
    );

    expect(result.success).toBe(true);
  });

  it("rejects per-analysis column arrays with mismatched lengths", () => {
    const result = experimentSnapshotAnalysisChunkValidator.safeParse(
      makeExperimentSnapshotAnalysisChunk({
        analysisOne: {
          numRows: 2,
          d: ["All"],
          v: [0, 1],
          value: [0.1, 0.2, 0.3],
        },
      }),
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            message:
              'Column "d" in analysis "analysisOne" has 1 rows, expected 2',
            path: ["data", "analysisOne", "d"],
          }),
          expect.objectContaining({
            message:
              'Column "value" in analysis "analysisOne" has 3 rows, expected 2',
            path: ["data", "analysisOne", "value"],
          }),
        ]),
      );
    }
  });

  it("rejects per-analysis numRows that disagrees with the column length", () => {
    const result = experimentSnapshotAnalysisChunkValidator.safeParse(
      makeExperimentSnapshotAnalysisChunk({
        analysisOne: {
          numRows: 3,
          d: ["All", "All"],
          v: [0, 1],
        },
      }),
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            message:
              'numRows for analysis "analysisOne" has 3 rows, expected 2',
            path: ["data", "analysisOne", "numRows"],
          }),
        ]),
      );
    }
  });

  it("rejects analysisKey sub-paths that contain MongoDB-reserved characters", () => {
    const result = experimentSnapshotAnalysisChunkValidator.safeParse(
      makeExperimentSnapshotAnalysisChunk({
        "bad.key": { numRows: 0, d: [], v: [] },
      }),
    );
    expect(result.success).toBe(false);
  });

  it("throws from the model-layer helper when column lengths are invalid", () => {
    expect(() =>
      validateExperimentSnapshotAnalysisChunkColumnLengths({
        data: {
          analysisOne: {
            numRows: 2,
            d: ["All"],
            v: [0, 1],
          },
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

describe("analysisKey helpers", () => {
  it("buildAnalysisKey produces unique strings", () => {
    const keys = new Set<string>();
    for (let i = 0; i < 100; i++) keys.add(buildAnalysisKey());
    expect(keys.size).toBe(100);
  });

  it("buildAnalysisKey produces MongoDB-sub-path-safe keys", () => {
    const key = buildAnalysisKey();
    expect(key).not.toContain(".");
    expect(key).not.toContain("$");
    expect(key.length).toBeGreaterThan(0);
  });
});

describe("encodeSnapshotAnalysisChunks", () => {
  it("produces one chunk per metric", () => {
    const keyA = buildAnalysisKey();
    const analyses = [
      makeAnalysis(
        [
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
        ],
        {},
        keyA,
      ),
    ];

    const { metricChunks } = encodeSnapshotAnalysisChunks(analyses, [
      "met_a",
      "met_b",
    ]);

    expect(metricChunks.size).toBe(2);
    expect(metricChunks.has("met_a")).toBe(true);
    expect(metricChunks.has("met_b")).toBe(true);

    // Each metric has the analysis sub-path with 2 rows (2 variations)
    const perMetA = metricChunks.get("met_a")!;
    expect(Object.keys(perMetA)).toEqual([keyA]);
    expect(perMetA[keyA].numRows).toBe(2);
    expect(perMetA[keyA].d).toEqual(["All", "All"]);
    expect(perMetA[keyA].v).toEqual([0, 1]);
    // No positional "a" column — that was removed with the race fix.
    expect((perMetA[keyA] as Record<string, unknown>).a).toBeUndefined();
  });

  it("keys chunkedAnalysesMeta by analysisKey", () => {
    const keyA = buildAnalysisKey();
    const analyses = [
      makeAnalysis(
        [
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
        ],
        {},
        keyA,
      ),
    ];

    const { chunkedAnalysesMeta } = encodeSnapshotAnalysisChunks(analyses, [
      "met_1",
    ]);

    expect(Object.keys(chunkedAnalysesMeta)).toEqual([keyA]);
    expect(chunkedAnalysesMeta[keyA].dimensions).toHaveLength(2);
    expect(chunkedAnalysesMeta[keyA].dimensions[0]).toEqual({
      name: "All",
      srm: 0.5,
      variationUsers: [500, 600],
    });
    expect(chunkedAnalysesMeta[keyA].dimensions[1]).toEqual({
      name: "country:US",
      srm: 0.48,
      variationUsers: [200, 300],
    });
  });

  it("stores analyses under disjoint sub-paths in the same chunk", () => {
    const keyA = buildAnalysisKey();
    const keyB = buildAnalysisKey();
    const analyses = [
      makeAnalysis(
        [
          {
            name: "All",
            srm: 0.5,
            variations: [
              { users: 100, metrics: { met_1: makeMetric({ value: 1 }) } },
            ],
          },
        ],
        {},
        keyA,
      ),
      makeAnalysis(
        [
          {
            name: "All",
            srm: 0.51,
            variations: [
              { users: 200, metrics: { met_1: makeMetric({ value: 2 }) } },
            ],
          },
        ],
        { statsEngine: "frequentist" },
        keyB,
      ),
    ];

    const { metricChunks } = encodeSnapshotAnalysisChunks(analyses, ["met_1"]);
    const perMet1 = metricChunks.get("met_1")!;

    expect(Object.keys(perMet1).sort()).toEqual([keyA, keyB].sort());
    expect(perMet1[keyA].numRows).toBe(1);
    expect(perMet1[keyB].numRows).toBe(1);
    expect(perMet1[keyA].value).toEqual([1]);
    expect(perMet1[keyB].value).toEqual([2]);
  });

  it("throws when two analyses share an analysisKey", () => {
    const shared = buildAnalysisKey();
    const analyses = [
      makeAnalysis([], {}, shared),
      makeAnalysis([], { statsEngine: "frequentist" }, shared),
    ];
    expect(() => encodeSnapshotAnalysisChunks(analyses, [])).toThrow(
      /duplicate analysisKey/,
    );
  });

  it("handles empty results", () => {
    const analyses = [makeAnalysis([])];
    const { metricChunks, chunkedAnalysesMeta } = encodeSnapshotAnalysisChunks(
      analyses,
      [],
    );
    expect(metricChunks.size).toBe(0);
    expect(Object.keys(chunkedAnalysesMeta)).toHaveLength(1);
    expect(
      chunkedAnalysesMeta[analyses[0].analysisKey].dimensions,
    ).toHaveLength(0);
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
    expect(decoded[0].analysisKey).toBe(analyses[0].analysisKey);
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
    const analysisKey = buildAnalysisKey();
    const analysisMetadata = [
      {
        analysisKey,
        settings: makeAnalysisSettings(),
        dateCreated: new Date("2025-01-01"),
        status: "success" as const,
      },
    ];
    const chunkedAnalysesMeta: Record<string, AnalysisMetaEntry> = {
      [analysisKey]: {
        dimensions: [
          {
            name: "All",
            srm: 0.5,
            variationUsers: [100, 100, 100, 100, 100],
          },
        ],
      },
    };
    const decoded = decodeSnapshotAnalysisChunks(
      [
        {
          metricId: "met_1",
          data: {
            [analysisKey]: {
              numRows: 5,
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
    const analysisKey = buildAnalysisKey();
    const analysisMetadata = [
      {
        analysisKey,
        settings: makeAnalysisSettings(),
        dateCreated: new Date("2025-01-01"),
        status: "error" as const,
        error: "Something went wrong",
      },
    ];
    const chunkedAnalysesMeta: Record<string, AnalysisMetaEntry> = {
      [analysisKey]: { dimensions: [] },
    };

    const decoded = decodeSnapshotAnalysisChunks(
      [],
      chunkedAnalysesMeta,
      analysisMetadata,
    );
    expect(decoded[0].status).toBe("error");
    expect(decoded[0].error).toBe("Something went wrong");
  });

  it("skips chunk sub-paths whose analysisKey is missing from meta", () => {
    // Simulates the race-safety property: a chunk wrote a sub-path but the
    // parent snapshot was rolled back / is stale. Decoder must not mis-route
    // those rows; it must drop them silently.
    const keyAlive = buildAnalysisKey();
    const keyOrphan = buildAnalysisKey();

    const chunks: { metricId: string; data: MetricChunkData }[] = [
      {
        metricId: "met_1",
        data: {
          [keyAlive]: {
            numRows: 1,
            d: ["All"],
            v: [0],
            value: [1],
          },
          [keyOrphan]: {
            numRows: 1,
            d: ["All"],
            v: [0],
            value: [999],
          },
        },
      },
    ];

    const decoded = decodeSnapshotAnalysisChunks(
      chunks,
      {
        [keyAlive]: {
          dimensions: [{ name: "All", srm: 1, variationUsers: [100] }],
        },
      },
      [
        {
          analysisKey: keyAlive,
          settings: makeAnalysisSettings(),
          dateCreated: new Date("2025-01-01"),
          status: "success",
        },
      ],
    );

    expect(decoded).toHaveLength(1);
    expect(decoded[0].analysisKey).toBe(keyAlive);
    expect(decoded[0].results[0].variations[0].metrics.met_1.value).toBe(1);
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
      analyses,
      hasChunkedAnalyses: true,
    } satisfies ExperimentSnapshotInterface;

    const metricOrdering = buildMetricOrdering(
      snapshot.settings.goalMetrics,
      snapshot.settings.secondaryMetrics,
      snapshot.settings.guardrailMetrics,
    );
    const { metricChunks, chunkedAnalysesMeta } = encodeSnapshotAnalysisChunks(
      analyses,
      metricOrdering,
    );

    const storedSnapshot: ExperimentSnapshotInterface = {
      ...snapshot,
      analyses: analyses.map((a) => ({ ...a, results: [] })),
      chunkedAnalysesMeta,
    };

    const analysisMetadata = storedSnapshot.analyses.map((a) => ({
      analysisKey: a.analysisKey,
      settings: a.settings,
      dateCreated: a.dateCreated,
      status: a.status,
      ...(a.error ? { error: a.error } : {}),
    }));
    const chunks = Array.from(metricChunks.entries()).map(
      ([metricId, data]) => ({ metricId, data }),
    );
    const chunkedPathResult = decodeSnapshotAnalysisChunks(
      chunks,
      storedSnapshot.chunkedAnalysesMeta ?? {},
      analysisMetadata,
    );

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

describe("migrateLegacySnapshotAnalysisChunkData", () => {
  it("returns already-normalized docs unchanged with migrated=null (idempotence)", () => {
    const key = "an_preset";
    const newShape = {
      data: {
        [key]: {
          numRows: 2,
          d: ["All", "All"],
          v: [0, 1],
          value: [10, 15],
        },
      },
    };

    const result = migrateLegacySnapshotAnalysisChunkData(newShape);

    expect(result.migrated).toBeNull();
    expect(result.data).toBe(newShape.data);
    expect(result.data[key].numRows).toBe(2);
  });

  it("returns position-keyed docs unchanged with migrated=null (phase-2 input)", () => {
    // Phase 1 output is also valid input for phase 1 — so re-running it
    // (e.g. if `BaseModel.migrate` is invoked twice) is a no-op.
    const positionKeyed = {
      data: {
        "0": { numRows: 1, d: ["All"], v: [0], value: [1] },
        "1": { numRows: 1, d: ["All"], v: [0], value: [2] },
      },
    };

    const result = migrateLegacySnapshotAnalysisChunkData(positionKeyed);

    expect(result.migrated).toBeNull();
    expect(result.data).toBe(positionKeyed.data);
  });

  it("splits a legacy chunk into position-keyed records, one per legacy `a` value", () => {
    const legacyChunk = {
      numRows: 5,
      data: {
        a: [0, 0, 1, 1, 1],
        d: ["", "", "US", "US", "UK"],
        v: [0, 1, 0, 1, 1],
        value: [10, 15, 20, 25, 30],
        cr: [0.1, 0.15, 0.2, 0.25, 0.3],
        users: [100, 120, 50, 55, 60],
      },
    };

    const result = migrateLegacySnapshotAnalysisChunkData(legacyChunk);

    expect(result.migrated).toEqual({ legacyNumRows: 5, analysisCount: 2 });
    expect(Object.keys(result.data).sort()).toEqual(["0", "1"]);

    const aData = result.data["0"];
    expect(aData.numRows).toBe(2);
    expect(aData.d).toEqual(["", ""]);
    expect(aData.v).toEqual([0, 1]);
    expect(aData.value).toEqual([10, 15]);
    expect(aData.cr).toEqual([0.1, 0.15]);
    expect(aData.users).toEqual([100, 120]);

    const bData = result.data["1"];
    expect(bData.numRows).toBe(3);
    expect(bData.d).toEqual(["US", "US", "UK"]);
    expect(bData.v).toEqual([0, 1, 1]);
    expect(bData.value).toEqual([20, 25, 30]);
    expect(bData.cr).toEqual([0.2, 0.25, 0.3]);
    expect(bData.users).toEqual([50, 55, 60]);
  });

  it("treats missing `a` column as all-position-0 and keeps value columns intact", () => {
    const legacyChunk = {
      numRows: 2,
      data: {
        d: ["All", "All"],
        v: [0, 1],
        value: [7, 9],
      },
    };

    const result = migrateLegacySnapshotAnalysisChunkData(legacyChunk);

    expect(result.migrated).toEqual({ legacyNumRows: 2, analysisCount: 1 });
    expect(Object.keys(result.data)).toEqual(["0"]);
    expect(result.data["0"].numRows).toBe(2);
    expect(result.data["0"].d).toEqual(["All", "All"]);
    expect(result.data["0"].v).toEqual([0, 1]);
    expect(result.data["0"].value).toEqual([7, 9]);
  });

  it("handles empty legacy chunks (numRows=0) without producing sub-records", () => {
    const legacyChunk = { numRows: 0, data: {} };

    const result = migrateLegacySnapshotAnalysisChunkData(legacyChunk);

    expect(result.migrated).toEqual({ legacyNumRows: 0, analysisCount: 0 });
    expect(result.data).toEqual({});
  });

  it("round-trips through remap + decode with asymmetric numRows", () => {
    const keyA = "an_a";
    const keyB = "an_b";
    const legacyChunk = {
      numRows: 5,
      data: {
        a: [0, 0, 1, 1, 1],
        d: ["", "", "US", "US", "UK"],
        v: [0, 1, 0, 1, 1],
        value: [10, 15, 20, 25, 30],
        cr: [0.1, 0.15, 0.2, 0.25, 0.3],
        users: [100, 120, 50, 55, 60],
      },
    };

    const { data: positionKeyed } =
      migrateLegacySnapshotAnalysisChunkData(legacyChunk);
    const data = remapChunkDataPositionKeysToAnalysisKeys(positionKeyed, [
      keyA,
      keyB,
    ]);

    const chunkedAnalysesMeta: Record<string, AnalysisMetaEntry> = {
      [keyA]: {
        dimensions: [{ name: "", srm: 0.95, variationUsers: [100, 120] }],
      },
      [keyB]: {
        dimensions: [
          { name: "US", srm: 0.9, variationUsers: [50, 55] },
          { name: "UK", srm: 0.88, variationUsers: [45, 60] },
        ],
      },
    };
    const analysisMetadata = [
      {
        analysisKey: keyA,
        settings: makeAnalysisSettings({ statsEngine: "bayesian" }),
        dateCreated: new Date("2025-01-01"),
        status: "success" as const,
      },
      {
        analysisKey: keyB,
        settings: makeAnalysisSettings({ statsEngine: "frequentist" }),
        dateCreated: new Date("2025-01-02"),
        status: "success" as const,
      },
    ];

    const decoded = decodeSnapshotAnalysisChunks(
      [{ metricId: "met_1", data }],
      chunkedAnalysesMeta,
      analysisMetadata,
    );

    expect(decoded).toHaveLength(2);

    // Analysis A: single dim, two variations, both populated.
    const aAll = decoded[0].results[0];
    expect(aAll.name).toBe("");
    expect(aAll.variations[0].metrics.met_1.value).toBe(10);
    expect(aAll.variations[0].metrics.met_1.users).toBe(100);
    expect(aAll.variations[1].metrics.met_1.value).toBe(15);

    // Analysis B: US has both variations; UK v0 had no legacy row -> no
    // metric entry (users hydrated from meta), UK v1 = 30.
    expect(decoded[1].results).toHaveLength(2);
    const bUs = decoded[1].results.find((r) => r.name === "US")!;
    const bUk = decoded[1].results.find((r) => r.name === "UK")!;
    expect(bUs.variations[0].metrics.met_1.value).toBe(20);
    expect(bUs.variations[1].metrics.met_1.value).toBe(25);
    expect(bUk.variations[0].users).toBe(45);
    expect(bUk.variations[0].metrics.met_1).toBeUndefined();
    expect(bUk.variations[1].metrics.met_1.value).toBe(30);
  });

  it("is deterministic across repeated calls (same input -> same output)", () => {
    const legacyChunk = {
      numRows: 5,
      data: {
        a: [0, 0, 1, 1, 1],
        d: ["", "", "US", "US", "UK"],
        v: [0, 1, 0, 1, 1],
        value: [10, 15, 20, 25, 30],
      },
    };

    const first = migrateLegacySnapshotAnalysisChunkData(legacyChunk);
    const second = migrateLegacySnapshotAnalysisChunkData(legacyChunk);

    expect(second.data).toEqual(first.data);
    expect(second.migrated).toEqual(first.migrated);
  });

  it("preserves new-shape sub-records coexisting with legacy flat columns", () => {
    // A legacy chunk that had a new-shape sub-record appended via
    // bulkWrite (writer path) before the migration ran. The migration
    // must rebuild the position-keyed legacy data AND keep the
    // pre-existing new-shape sub-record intact.
    const mixedShape = {
      numRows: 2,
      data: {
        a: [0, 0],
        d: ["All", "All"],
        v: [0, 1],
        value: [10, 15],
        an_newwrite: {
          numRows: 1,
          d: ["All"],
          v: [0],
          value: [42],
        },
      },
    };

    const result = migrateLegacySnapshotAnalysisChunkData(mixedShape);

    expect(result.migrated).toEqual({ legacyNumRows: 2, analysisCount: 1 });
    expect(Object.keys(result.data).sort()).toEqual(["0", "an_newwrite"]);

    // Position-keyed legacy data rebuilt correctly.
    expect(result.data["0"].numRows).toBe(2);
    expect(result.data["0"].value).toEqual([10, 15]);

    // New-shape sub-record preserved verbatim.
    expect(result.data["an_newwrite"].numRows).toBe(1);
    expect(result.data["an_newwrite"].value).toEqual([42]);
  });

  it("preserves multiple new-shape sub-records sequentially appended to a legacy chunk", () => {
    // Simulates two sequential writes to a still-legacy chunk doc: the
    // on-disk state accumulates two new-shape sub-records alongside
    // the untouched legacy columns. Migration must preserve both.
    const mixedShape = {
      numRows: 1,
      data: {
        a: [0],
        d: ["All"],
        v: [0],
        value: [1],
        an_first: { numRows: 1, d: ["All"], v: [0], value: [2] },
        an_second: { numRows: 1, d: ["All"], v: [0], value: [3] },
      },
    };

    const result = migrateLegacySnapshotAnalysisChunkData(mixedShape);

    expect(Object.keys(result.data).sort()).toEqual([
      "0",
      "an_first",
      "an_second",
    ]);
    expect(result.data["an_first"].value).toEqual([2]);
    expect(result.data["an_second"].value).toEqual([3]);
  });
});

describe("remapChunkDataPositionKeysToAnalysisKeys", () => {
  it("renames numeric position keys to the matching analysisKeys", () => {
    const positionKeyed: Record<string, AnalysisChunkData> = {
      "0": { numRows: 1, d: ["All"], v: [0], value: [10] },
      "1": { numRows: 1, d: ["All"], v: [0], value: [20] },
    };

    const remapped = remapChunkDataPositionKeysToAnalysisKeys(positionKeyed, [
      "an_first",
      "an_second",
    ]);

    expect(Object.keys(remapped).sort()).toEqual(["an_first", "an_second"]);
    expect(remapped["an_first"].value).toEqual([10]);
    expect(remapped["an_second"].value).toEqual([20]);
  });

  it("drops position keys that have no matching analysisKey (orphans)", () => {
    // Position 1's analysis was removed from the parent snapshot before
    // migration — its rows have no home.
    const positionKeyed: Record<string, AnalysisChunkData> = {
      "0": { numRows: 1, d: ["All"], v: [0], value: [10] },
      "1": { numRows: 1, d: ["All"], v: [0], value: [99] },
    };

    const remapped = remapChunkDataPositionKeysToAnalysisKeys(positionKeyed, [
      "an_only",
    ]);

    expect(Object.keys(remapped)).toEqual(["an_only"]);
    expect(remapped["an_only"].value).toEqual([10]);
  });

  it("passes already-renamed analysisKey-keyed data through unchanged (idempotence)", () => {
    const analysisKeyed: Record<string, AnalysisChunkData> = {
      an_first: { numRows: 1, d: ["All"], v: [0], value: [10] },
      an_second: { numRows: 1, d: ["All"], v: [0], value: [20] },
    };

    // Even with a non-empty analysisKeysByPosition, the renamer must
    // recognize that these are not numeric positions and leave them be.
    const remapped = remapChunkDataPositionKeysToAnalysisKeys(analysisKeyed, [
      "an_other",
    ]);

    expect(Object.keys(remapped).sort()).toEqual(["an_first", "an_second"]);
    expect(remapped["an_first"]).toBe(analysisKeyed["an_first"]);
    expect(remapped["an_second"]).toBe(analysisKeyed["an_second"]);
  });
});
