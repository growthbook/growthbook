import { FactMetricInterface } from "shared/types/fact-table";
import BigQuery from "back-end/src/integrations/BigQuery";
import { N_STAR_VALUES } from "back-end/src/services/experimentQueries/constants";

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
    const metricStub: Partial<FactMetricInterface> = {
      metricType: "quantile",
      quantileSettings: { type: "event", quantile: 0.9, ignoreZeros: false },
      numerator: { factTableId: "ft1", column: "amount", filters: [] },
    };
    const metadata = integration.getAggregationMetadata({
      metric: metricStub as FactMetricInterface,
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
