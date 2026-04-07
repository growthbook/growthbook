import { ExperimentSnapshotSettings } from "shared/types/experiment-snapshot";
import { ExposureQuery } from "shared/types/datasource";
import BigQuery from "back-end/src/integrations/BigQuery";
import { N_STAR_VALUES } from "back-end/src/services/experimentQueries/constants";
import { factTableFactory } from "../factories/FactTable.factory";
import { factMetricFactory } from "../factories/FactMetric.factory";

type MockBigQueryJob = {
  id: string;
  getQueryResults: jest.Mock;
  getMetadata: jest.Mock;
};

describe("BigQuery reservation job config", () => {
  let integration: BigQuery;
  let mockJob: MockBigQueryJob;
  let mockCreateQueryJob: jest.Mock;

  beforeEach(() => {
    // @ts-expect-error -- context/datasource not needed for this unit test
    integration = new BigQuery("", {});

    mockJob = {
      id: "job_123",
      getQueryResults: jest.fn().mockResolvedValue([[], undefined, undefined]),
      getMetadata: jest.fn().mockResolvedValue([{}]),
    };

    mockCreateQueryJob = jest.fn().mockResolvedValue([mockJob]);

    jest
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .spyOn(integration as any, "getClient")
      .mockReturnValue({ createQueryJob: mockCreateQueryJob });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("includes reservation in query job config when set", async () => {
    integration.params = {
      reservation:
        "projects/my-project/locations/US/reservations/my-reservation",
    };

    await integration.runQuery("SELECT 1");

    const queryJobConfig = mockCreateQueryJob.mock.calls[0][0];
    expect(queryJobConfig).toEqual({
      labels: { integration: "growthbook" },
      query: "SELECT 1",
      useLegacySql: false,
      reservation:
        "projects/my-project/locations/US/reservations/my-reservation",
    });
  });

  it("does not include reservation in query job config when missing", async () => {
    integration.params = {};

    await integration.runQuery("SELECT 1");

    const queryJobConfig = mockCreateQueryJob.mock.calls[0][0];
    expect(queryJobConfig).toEqual({
      labels: { integration: "growthbook" },
      query: "SELECT 1",
      useLegacySql: false,
    });
    expect(queryJobConfig).not.toHaveProperty("reservation");
  });
});

describe("BigQuery KLL quantile sketch methods", () => {
  let integration: BigQuery;

  beforeEach(() => {
    // @ts-expect-error -- context/datasource not needed for this unit test
    integration = new BigQuery("", {});
  });

  it("reports KLL support", () => {
    expect(integration.hasQuantileKLL()).toBe(true);
  });

  it("maps kll data type to BYTES", () => {
    expect(integration.getDataType("kll")).toBe("BYTES");
  });

  it("generates KLL INIT with hardcoded precision 1000", () => {
    expect(integration.kllInit("m.value")).toBe(
      "KLL_QUANTILES.INIT_FLOAT64(m.value, 1000)",
    );
  });

  it("generates KLL MERGE_PARTIAL", () => {
    expect(integration.kllMergePartial("sketch_col")).toBe(
      "KLL_QUANTILES.MERGE_PARTIAL(sketch_col)",
    );
  });

  it("generates KLL EXTRACT_POINT", () => {
    expect(integration.kllExtractPoint("sketch_col", 0.95)).toBe(
      "KLL_QUANTILES.EXTRACT_POINT_FLOAT64(sketch_col, 0.95)",
    );
  });

  it("generates KLL EXTRACT (quantile array)", () => {
    expect(integration.kllExtractQuantiles("sketch_col", 100)).toBe(
      "KLL_QUANTILES.EXTRACT_FLOAT64(sketch_col, 100)",
    );
  });

  it("generates rank approximation via CDF counting", () => {
    const sql = integration.kllRankApprox(
      "m.sketch",
      "qm.q_hat",
      "m.n_events",
      100,
    );
    // 100 quantiles → 101 points at levels {0, 1/100, ..., 1}.
    // count of points strictly below percentile p is ≈100p, so divide by 100
    // (not 101) for an unbiased estimate.
    expect(sql).toContain("KLL_QUANTILES.EXTRACT_FLOAT64(m.sketch, 100)");
    expect(sql).toContain("WHERE p < qm.q_hat");
    expect(sql).toContain("* m.n_events / 100.0");
    expect(sql).toContain("COALESCE(");
  });

  it("generates quantile grid columns from a KLL sketch", () => {
    const grid = integration.getKllQuantileGridColumns(
      { type: "event", quantile: 0.9, ignoreZeros: false },
      "m0_sketch",
      "m0_",
    );
    // Point estimate
    expect(grid).toContain(
      "KLL_QUANTILES.EXTRACT_POINT_FLOAT64(m0_sketch, 0.9) AS m0_quantile",
    );
    // One pair of lower/upper bounds per N_STAR value
    for (const nstar of N_STAR_VALUES) {
      expect(grid).toContain(`m0_quantile_lower_${nstar}`);
      expect(grid).toContain(`m0_quantile_upper_${nstar}`);
    }
    // All grid columns come from EXTRACT_POINT on the same sketch
    const extractCount = (
      grid.match(/KLL_QUANTILES\.EXTRACT_POINT_FLOAT64\(m0_sketch,/g) || []
    ).length;
    expect(extractCount).toBe(1 + N_STAR_VALUES.length * 2);
  });

  it("returns kll intermediate data type for event quantile metrics", () => {
    const metric = factMetricFactory.build({
      metricType: "quantile",
      quantileSettings: { type: "event", quantile: 0.9, ignoreZeros: false },
      numerator: { factTableId: "ft1", column: "amount" },
    });
    const metadata = integration.getAggregationMetadata({
      metric,
      useDenominator: false,
    });
    expect(metadata.intermediateDataType).toBe("kll");
    expect(metadata.partialAggregationFunction("col")).toBe(
      "KLL_QUANTILES.INIT_FLOAT64(col, 1000)",
    );
    expect(metadata.reAggregationFunction("col")).toBe(
      "KLL_QUANTILES.MERGE_PARTIAL(col)",
    );
  });
});

describe("BigQuery KLL incremental refresh SQL generation (E2E)", () => {
  let integration: BigQuery;

  const exposureQuery: ExposureQuery = {
    id: "exposure",
    name: "Exposure",
    description: "",
    query: "*",
    userIdType: "user_id",
    dimensions: [],
  };

  const factTable = factTableFactory.build({
    id: "ft_events",
    name: "Events",
    sql: "SELECT * FROM events",
    userIdTypes: ["user_id"],
  });

  const eventQuantileMetric = factMetricFactory.build({
    id: "fact_eq1",
    metricType: "quantile",
    quantileSettings: { type: "event", quantile: 0.9, ignoreZeros: false },
    numerator: {
      factTableId: "ft_events",
      column: "amount",
      aggregation: "sum",
    },
  });

  const factTableMap = new Map([["ft_events", factTable]]);

  const settings: ExperimentSnapshotSettings = {
    manual: false,
    dimensions: [],
    metricSettings: [],
    goalMetrics: [],
    secondaryMetrics: [],
    guardrailMetrics: [],
    activationMetric: null,
    defaultMetricPriorSettings: {
      override: false,
      proper: false,
      mean: 0,
      stddev: 0,
    },
    regressionAdjustmentEnabled: false,
    attributionModel: "firstExposure",
    experimentId: "exp_1",
    queryFilter: "",
    segment: "",
    skipPartialData: false,
    datasourceId: "ds_1",
    exposureQueryId: "exposure",
    startDate: new Date("2024-01-01"),
    endDate: new Date("2024-01-31"),
    variations: [],
  };

  beforeEach(() => {
    // @ts-expect-error -- context/datasource not needed for this unit test
    integration = new BigQuery("", {});
    jest
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .spyOn(integration as any, "getExposureQuery")
      .mockReturnValue(exposureQuery);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("getCreateMetricSourceTableQuery emits BYTES sketch + INT64 n_events columns", () => {
    const sql = integration.getCreateMetricSourceTableQuery({
      settings,
      metrics: [eventQuantileMetric],
      factTableMap,
      metricSourceTableFullName: "proj.ds.metric_source",
    });
    // KLL sketch stored as BYTES
    expect(sql).toMatch(/_value\s+BYTES/);
    // Companion event-count column for cluster variance
    expect(sql).toMatch(/_n_events\s+INT64/);
  });

  it("getInsertMetricSourceDataQuery emits KLL INIT and COUNT for n_events", () => {
    const sql = integration.getInsertMetricSourceDataQuery({
      settings,
      activationMetric: null,
      factTableMap,
      metricSourceTableFullName: "proj.ds.metric_source",
      unitsSourceTableFullName: "proj.ds.units",
      metrics: [eventQuantileMetric],
      lastMaxTimestamp: null,
    });
    // Partial aggregation builds the sketch
    expect(sql).toContain("KLL_QUANTILES.INIT_FLOAT64");
    // Companion count emitted alongside the sketch
    expect(sql).toMatch(/COUNT\([^)]+\)\s+AS\s+\w+_n_events/);
  });

  it("getIncrementalRefreshStatisticsQuery emits two-pass KLL rank recovery CTEs", () => {
    const sql = integration.getIncrementalRefreshStatisticsQuery({
      settings,
      activationMetric: null,
      dimensionsForPrecomputation: [],
      dimensionsForAnalysis: [],
      factTableMap,
      metricSourceTableFullName: "proj.ds.metric_source",
      metricSourceCovariateTableFullName: null,
      unitsSourceTableFullName: "proj.ds.units",
      metrics: [eventQuantileMetric],
      lastMaxTimestamp: null,
    });

    // Pass 1: per-variation sketch merge
    expect(sql).toContain("__eventQuantileSketch");
    expect(sql).toContain("KLL_QUANTILES.MERGE_PARTIAL");

    // Grid extraction: 1 point estimate + 20 × 2 bounds = 41 EXTRACT_POINT calls
    expect(sql).toContain("__eventQuantileMetric");
    const extractPointCount = (
      sql.match(/KLL_QUANTILES\.EXTRACT_POINT_FLOAT64/g) || []
    ).length;
    expect(extractPointCount).toBe(1 + N_STAR_VALUES.length * 2);

    // Pass 2: per-user rank recovery via CDF counting
    expect(sql).toContain("KLL_QUANTILES.EXTRACT_FLOAT64");
    expect(sql).toMatch(/LEFT JOIN\s+__eventQuantileMetric\s+qm/);

    // CTE ordering: sketch merge must precede grid extraction, which must
    // precede __joinedData (since __joinedData joins on the grid's q_hat)
    const sketchPos = sql.indexOf("__eventQuantileSketch");
    const gridPos = sql.indexOf("__eventQuantileMetric");
    const joinedPos = sql.indexOf("__joinedData");
    expect(sketchPos).toBeGreaterThan(0);
    expect(gridPos).toBeGreaterThan(sketchPos);
    expect(joinedPos).toBeGreaterThan(gridPos);
  });
});
