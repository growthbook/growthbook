import BigQuery from "back-end/src/integrations/BigQuery";

describe("SqlIntegration row parsing (scientific-notation result columns)", () => {
  let integration: BigQuery;

  beforeEach(() => {
    // @ts-expect-error -- context/datasource not needed for this unit test
    integration = new BigQuery("", { type: "bigquery" });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const useRows = (rows: Record<string, unknown>[]): void => {
    jest.spyOn(integration, "runQuery").mockResolvedValue({ rows });
  };

  it("parses users with scientific notation in the snapshot metric query", async () => {
    useRows([
      {
        variation: "0",
        users: "3.518884E7",
        main_sum: "1e3",
        main_sum_squares: "1e4",
      },
    ]);

    const response = await integration.runSnapshotMetricQuery(
      "SELECT 1",
      async () => {
        /* no external id */
      },
      { queryType: "experimentMetric" },
    );

    // parseInt() would have collapsed this to 3
    expect(response.rows[0].users).toBe(35188840);
    expect(response.rows[0].count).toBe(35188840);
    // Float columns are unaffected but pinned as part of the row shape
    expect(response.rows[0].main_sum).toBe(1000);
    expect(response.rows[0].main_sum_squares).toBe(10000);
  });

  it("keeps plain-integer users unchanged in the snapshot metric query", async () => {
    useRows([{ variation: "1", users: "35188840" }]);

    const response = await integration.runSnapshotMetricQuery(
      "SELECT 1",
      async () => {
        /* no external id */
      },
      { queryType: "experimentMetric" },
    );

    expect(response.rows[0].users).toBe(35188840);
    expect(response.rows[0].count).toBe(35188840);
  });

  it("parses multiple_exposures and degrees_of_freedom with scientific notation in the bandit SRM query", async () => {
    useRows([
      {
        row_type: "cell",
        statistic: "1.5e3",
        degrees_of_freedom: "1.5e2",
        bandit_version: "1",
        leaf_id: "42",
        variation: "0",
        observed: "3.518884E7",
        expected: "3.518884E7",
        multiple_exposures: "3.518884E7",
      },
      {
        row_type: "summary",
        statistic: "0.25",
        degrees_of_freedom: "2",
        bandit_version: "1",
        leaf_id: "",
        variation: "",
        observed: "100",
        expected: "100",
        multiple_exposures: "35188840",
      },
    ]);

    const response = await integration.runContextualBanditSrmQuery(
      "SELECT 1",
      async () => {
        /* no external id */
      },
      { queryType: "experimentTraffic" },
    );

    expect(response.rows[0]).toEqual({
      row_type: "cell",
      statistic: 1500,
      degrees_of_freedom: 150,
      bandit_version: "1",
      leaf_id: "42",
      variation: "0",
      observed: 35188840,
      expected: 35188840,
      multiple_exposures: 35188840,
    });
    // Plain integers keep their exact values
    expect(response.rows[1].degrees_of_freedom).toBe(2);
    expect(response.rows[1].multiple_exposures).toBe(35188840);
  });

  it("parses users with scientific notation in the past experiment query", async () => {
    useRows([
      {
        exposure_query: "exposure",
        identifier_type: "user_id",
        experiment_id: "exp_1",
        experiment_name: "Test",
        variation_id: "0",
        variation_name: "Control",
        users: "3.518884E7",
        end_date: "2024-01-31T00:00:00Z",
        start_date: "2024-01-01T00:00:00Z",
        latest_data: "2024-01-31T00:00:00Z",
      },
    ]);

    const response = await integration.runPastExperimentQuery(
      "SELECT 1",
      async () => {
        /* no external id */
      },
      { queryType: "pastExperiment" },
    );

    expect(response.rows[0].users).toBe(35188840);
  });
});
