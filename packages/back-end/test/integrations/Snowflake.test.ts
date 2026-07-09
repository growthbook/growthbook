import Snowflake from "back-end/src/integrations/Snowflake";
import { getAggregationMetadata } from "back-end/src/integrations/sql/fact-metrics/aggregation-metadata";
import { N_STAR_VALUES } from "back-end/src/services/experimentQueries/constants";
import { factMetricFactory } from "../factories/FactMetric.factory";

describe("Snowflake quantile sketch methods", () => {
  let integration: Snowflake;

  beforeEach(() => {
    // @ts-expect-error -- context/datasource not needed for dialect-only tests
    integration = new Snowflake("", {});
  });

  it("reports quantile sketch support", () => {
    expect(integration.hasQuantileSketch()).toBe(true);
  });

  it("maps quantileSketch data type to OBJECT (t-digest state, not BYTES)", () => {
    // Critical: APPROX_PERCENTILE_ACCUMULATE returns an OBJECT (JSON), unlike
    // HLL_ACCUMULATE which returns BINARY. Round-tripping through BINARY would
    // break the sketch.
    expect(integration.getSqlDialect().getDataType("quantileSketch")).toBe(
      "OBJECT",
    );
    expect(integration.getSqlDialect().getDataType("hll")).toBe("BINARY");
  });

  it("generates APPROX_PERCENTILE_ACCUMULATE for INIT", () => {
    expect(integration.getSqlDialect().quantileSketchInit("m.value")).toBe(
      "APPROX_PERCENTILE_ACCUMULATE(m.value)",
    );
  });

  it("generates APPROX_PERCENTILE_COMBINE for MERGE_PARTIAL", () => {
    expect(
      integration.getSqlDialect().quantileSketchMergePartial("sketch_col"),
    ).toBe("APPROX_PERCENTILE_COMBINE(sketch_col)");
  });

  it("generates APPROX_PERCENTILE_ESTIMATE for EXTRACT_POINT", () => {
    expect(
      integration
        .getSqlDialect()
        .quantileSketchExtractPoint("sketch_col", 0.95),
    ).toBe("APPROX_PERCENTILE_ESTIMATE(sketch_col, 0.95)");
  });

  it("does not implement batch quantile extraction (rank approx uses unrolled CASE WHEN instead)", () => {
    // Snowflake's APPROX_PERCENTILE family has no batch-extract equivalent of
    // BigQuery's KLL_QUANTILES.EXTRACT_FLOAT64. We rely on the inherited base
    // throw — the rank-approx path unrolls per-point estimates instead.
    expect(() =>
      integration
        .getSqlDialect()
        .quantileSketchExtractQuantiles("sketch_col", 100),
    ).toThrow(/not supported/i);
  });

  describe("quantileSketchRankApprox", () => {
    it("unrolls numQuantiles+1 APPROX_PERCENTILE_ESTIMATE calls at evenly spaced grid points", () => {
      const sql = integration
        .getSqlDialect()
        .quantileSketchRankApprox("m.sketch", "qm.q_hat", "m.n_events", 4);
      // 4 quantiles → 5 grid points at p = 0, 0.25, 0.5, 0.75, 1
      const estimateCount = (
        sql.match(/APPROX_PERCENTILE_ESTIMATE\(m\.sketch,/g) || []
      ).length;
      expect(estimateCount).toBe(5);
      // The CASE WHEN sum has numQuantiles+1 terms joined by " + "
      const caseWhenCount = (sql.match(/CASE WHEN/g) || []).length;
      expect(caseWhenCount).toBe(5);
      // Grid points are formatted with toFixed(6)
      expect(sql).toContain("APPROX_PERCENTILE_ESTIMATE(m.sketch, 0.000000)");
      expect(sql).toContain("APPROX_PERCENTILE_ESTIMATE(m.sketch, 0.250000)");
      expect(sql).toContain("APPROX_PERCENTILE_ESTIMATE(m.sketch, 0.500000)");
      expect(sql).toContain("APPROX_PERCENTILE_ESTIMATE(m.sketch, 0.750000)");
      expect(sql).toContain("APPROX_PERCENTILE_ESTIMATE(m.sketch, 1.000000)");
    });

    it("compares each grid estimate against the outer threshold column", () => {
      const sql = integration
        .getSqlDialect()
        .quantileSketchRankApprox("m.sketch", "qm.q_hat", "m.n_events", 4);
      // Every CASE WHEN must compare a grid estimate against the threshold
      // column directly (no subquery, no correlation).
      const cmpCount = (sql.match(/< qm\.q_hat THEN 1 ELSE 0 END/g) || [])
        .length;
      expect(cmpCount).toBe(5);
    });

    it("scales the count by nEvents / numQuantiles inside a COALESCE(..., 0)", () => {
      const sql = integration
        .getSqlDialect()
        .quantileSketchRankApprox("m.sketch", "qm.q_hat", "m.n_events", 100);
      // 100 quantiles → divide by 100.0 (not 101) for an unbiased estimate of
      // the fraction below threshold.
      expect(sql).toContain("* m.n_events / 100.0");
      // COALESCE protects against NULL nEvents (0 * NULL = NULL); a NULL
      // sketch yields a 0 sum naturally so this is the only path to NULL.
      expect(sql).toMatch(/^COALESCE\(/);
      expect(sql).toMatch(/, 0\)$/);
    });

    it("never uses correlated UNNEST / FLATTEN / subquery shapes (the BigQuery pattern)", () => {
      const sql = integration
        .getSqlDialect()
        .quantileSketchRankApprox("m.sketch", "qm.q_hat", "m.n_events", 100);
      // Snowflake can't decorrelate a subquery whose FROM clause references
      // outer columns — that's the whole reason this is unrolled.
      expect(sql).not.toMatch(/\bUNNEST\b/i);
      expect(sql).not.toMatch(/\bFLATTEN\b/i);
      expect(sql).not.toMatch(/\bSELECT\b/i);
      expect(sql).not.toMatch(/\bFROM\b/i);
    });

    it("scales linearly: numQuantiles+1 estimates regardless of numQuantiles", () => {
      for (const n of [1, 10, 100]) {
        const sql = integration
          .getSqlDialect()
          .quantileSketchRankApprox("s", "t", "ne", n);
        const estimateCount = (
          sql.match(/APPROX_PERCENTILE_ESTIMATE\(s,/g) || []
        ).length;
        expect(estimateCount).toBe(n + 1);
        expect(sql).toContain(`/ ${n}.0`);
      }
    });
  });

  it("generates quantile grid columns from a merged sketch", () => {
    const grid = integration.getQuantileSketchGridColumns(
      { type: "event", quantile: 0.9, ignoreZeros: false },
      "m0_sketch",
      "m0_",
    );
    // Point estimate at the requested quantile
    expect(grid).toContain(
      "APPROX_PERCENTILE_ESTIMATE(m0_sketch, 0.9) AS m0_quantile",
    );
    // One pair of lower/upper bounds per N_STAR value
    for (const nstar of N_STAR_VALUES) {
      expect(grid).toContain(`m0_quantile_lower_${nstar}`);
      expect(grid).toContain(`m0_quantile_upper_${nstar}`);
    }
    // All grid columns must come from EXTRACT_POINT on the same sketch — no
    // re-aggregation, no per-bound merges.
    const extractCount = (
      grid.match(/APPROX_PERCENTILE_ESTIMATE\(m0_sketch,/g) || []
    ).length;
    expect(extractCount).toBe(1 + N_STAR_VALUES.length * 2);
  });

  it("returns quantileSketch aggregation metadata for event quantile metrics", () => {
    const metric = factMetricFactory.build({
      metricType: "quantile",
      quantileSettings: { type: "event", quantile: 0.9, ignoreZeros: false },
      numerator: { factTableId: "ft1", column: "amount" },
    });
    const metadata = getAggregationMetadata(integration.getSqlDialect(), {
      metric,
      useDenominator: false,
    });
    expect(metadata.intermediateDataType).toBe("quantileSketch");
    // Partial step builds the sketch from raw values
    expect(metadata.partialAggregationFunction("col")).toBe(
      "APPROX_PERCENTILE_ACCUMULATE(col)",
    );
    // Re-aggregation merges sketches across partitions
    expect(metadata.reAggregationFunction("col")).toBe(
      "APPROX_PERCENTILE_COMBINE(col)",
    );
  });

  it("merges (not INIT) pre-built sketch columns for event-quantile 'kll merge'", () => {
    const metric = factMetricFactory.build({
      metricType: "quantile",
      quantileSettings: { type: "event", quantile: 0.9, ignoreZeros: false },
      numerator: {
        factTableId: "ft1",
        column: "latency_ms_sketch",
        aggregation: "kll merge",
      },
    });
    const metadata = getAggregationMetadata(integration.getSqlDialect(), {
      metric,
      useDenominator: false,
    });
    expect(metadata.intermediateDataType).toBe("quantileSketch");
    // Pre-built sketches must be COMBINEd, never re-ACCUMULATEd from scratch.
    expect(metadata.partialAggregationFunction("col")).toBe(
      "APPROX_PERCENTILE_COMBINE(col)",
    );
    expect(metadata.partialAggregationFunction("col")).not.toContain(
      "ACCUMULATE",
    );
    expect(metadata.reAggregationFunction("col")).toBe(
      "APPROX_PERCENTILE_COMBINE(col)",
    );
  });
});
