import { ExperimentSnapshotSettings } from "shared/types/experiment-snapshot";
import { ExposureQuery } from "shared/types/datasource";
import { SegmentInterface } from "shared/types/segment";
import BigQuery from "back-end/src/integrations/BigQuery";

// Segment and SQL filter on the incremental refresh path: both must be
// applied to the new exposures before they are merged into the units table,
// with the same semantics as the non-incremental units query (segment joined
// on the unit id with `s.date <= e.timestamp`; query filter as an extra WHERE
// clause on the exposure rows).

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
    expect(cte).toMatch(
      /FROM\s+__newExposures e\s+JOIN __segment s ON \(s\.user_id = e\.user_id\)/,
    );
    expect(cte).toContain("AND s.date <= e.timestamp");
  });

  it("applies the query filter to new exposures", () => {
    const sql = buildSql(
      { ...baseSettings, queryFilter: "e.country = 'US'" },
      null,
    );
    const cte = newExposuresCte(sql);
    expect(cte).toMatch(/WHERE[\s\S]*AND \(\s*e\.country = 'US'\s*\)/);
    expect(sql).not.toContain("__segment");
  });

  it("leaves the new exposures unfiltered without a segment or query filter", () => {
    const sql = buildSql(baseSettings, null);
    const cte = newExposuresCte(sql);
    expect(sql).not.toContain("__segment");
    expect(cte).not.toContain("JOIN");
    expect(cte).not.toContain("s.date");
    expect(cte).toMatch(
      /FROM\s+__newExposures e\s+WHERE\s+e\.experiment_id = 'exp_1'/,
    );
    // Only the experiment id and the timestamp bounds remain.
    expect(cte.match(/\bAND\b/g)).toHaveLength(2);
  });
});
