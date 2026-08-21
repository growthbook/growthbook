import { ExperimentSnapshotSettings } from "shared/types/experiment-snapshot";
import { ExposureQuery } from "shared/types/datasource";
import { SegmentInterface } from "shared/types/segment";
import BigQuery from "back-end/src/integrations/BigQuery";

// Incremental units query must apply segment and queryFilter to new
// exposures only, with the same JOIN / WHERE s.date <= timestamp shape as
// the non-incremental units query. Query filter stays on the exposure CTE
// so its columns cannot collide with the segment relation.

const exposureQuery: ExposureQuery = {
  id: "exposure",
  name: "Exposure",
  description: "",
  query: "SELECT * FROM exposures",
  userIdType: "user_id",
  dimensions: [],
};

const resolvedExposureQuery = {
  query: exposureQuery.query,
  userIdType: exposureQuery.userIdType,
};

const segment: SegmentInterface = {
  id: "seg_1",
  organization: "org_1",
  owner: "",
  datasource: "ds_1",
  dateCreated: new Date("2024-01-01"),
  dateUpdated: new Date("2024-01-01"),
  name: "Paid users",
  description: "",
  userIdType: "user_id",
  type: "SQL",
  sql: "SELECT user_id, date FROM paid_users",
};

const baseSettings: ExperimentSnapshotSettings = {
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
  endDate: new Date("2024-02-01"),
  variations: [],
};

function newExposuresCte(sql: string): string {
  const start = sql.indexOf("__filteredNewExposures AS (");
  const end = sql.indexOf("__jointExposures AS (");
  expect(start).toBeGreaterThan(0);
  expect(end).toBeGreaterThan(start);
  return sql.slice(start, end);
}

describe("incremental refresh units query segment and query filter", () => {
  let integration: BigQuery;

  beforeEach(() => {
    // @ts-expect-error -- context not needed for this unit test
    integration = new BigQuery("", {
      settings: { queries: { exposure: [exposureQuery] } },
    });
  });

  function buildSql(
    settings: ExperimentSnapshotSettings,
    segmentObj: SegmentInterface | null,
  ) {
    return integration.getUpdateExperimentIncrementalUnitsQuery({
      settings,
      exposureQuery: resolvedExposureQuery,
      activationMetric: null,
      dimensions: [],
      factTableMap: new Map(),
      segment: segmentObj,
      unitsTableFullName: "proj.ds.units",
      unitsTempTableFullName: "proj.ds.units_tmp",
      incrementalRefreshStartTime: new Date("2024-01-15"),
      lastMaxTimestamp: null,
    });
  }

  it("filters new exposures through the segment", () => {
    const sql = buildSql({ ...baseSettings, segment: "seg_1" }, segment);
    expect(sql).toMatch(/__segment as \(/i);
    const cte = newExposuresCte(sql);
    expect(cte).toMatch(/JOIN __segment s ON \(s\.user_id = e\.user_id\)/i);
    // Timestamp stays raw for UNION with the units table; BQ still needs
    // the exposure side cast to compare against the segment DATETIME.
    expect(cte).toMatch(
      /s\.date <= CAST\s*\(\s*e\.timestamp as DATETIME\s*\)/i,
    );
    expect(cte).toMatch(/SELECT DISTINCT/i);
    expect(sql).toMatch(
      /MAX\s*\(\s*timestamp\s*\)\s+OVER\s*\(\s*\)[\s\S]*FROM\s+__segmentedNewExposures/i,
    );
    expect(cte).not.toMatch(/EXISTS/i);
  });

  it("applies the query filter to new exposures", () => {
    const sql = buildSql(
      { ...baseSettings, queryFilter: "e.country = 'US'" },
      null,
    );
    const cte = newExposuresCte(sql);
    expect(cte).toMatch(/WHERE[\s\S]*AND \(\s*e\.country = 'US'\s*\)/);
    expect(sql).not.toContain("__segment");
    expect(sql).not.toContain("__segmentedNewExposures");
  });

  it("applies both the segment and the query filter to new exposures", () => {
    const sql = buildSql(
      { ...baseSettings, segment: "seg_1", queryFilter: "country = 'US'" },
      segment,
    );
    const cte = newExposuresCte(sql);
    expect(cte).toMatch(/AND \(\s*country = 'US'\s*\)/);
    expect(cte).toMatch(/JOIN __segment s ON/i);
    // Query filter is on __filteredNewExposures so unqualified columns
    // cannot collide with the later segment join.
    expect(cte.indexOf("country")).toBeLessThan(cte.search(/JOIN __segment/i));
  });

  it("leaves the new exposures unfiltered without a segment or query filter", () => {
    const sql = buildSql(baseSettings, null);
    const cte = newExposuresCte(sql);
    expect(sql).not.toContain("__segment");
    expect(sql).not.toContain("__segmentedNewExposures");
    expect(cte).not.toContain("JOIN");
    expect(cte).not.toMatch(/EXISTS/i);
    expect(cte).not.toContain("s.date");
    expect(cte).toMatch(
      /FROM\s+__newExposures e\s+WHERE\s+e\.experiment_id = 'exp_1'/,
    );
  });
});
