import { ExperimentSnapshotSettings } from "shared/types/experiment-snapshot";
import { ExposureQuery } from "shared/types/datasource";
import BigQuery from "back-end/src/integrations/BigQuery";
import { bigQueryDialect } from "back-end/src/integrations/dialects/bigquery";
import { afterWatermark } from "back-end/src/integrations/sql/primitives/after-watermark";
import { getInsertAggregatedFactTableDataQuery } from "back-end/src/integrations/sql/queries/insert-aggregated-fact-table-data-query";
import { factTableFactory } from "../factories/FactTable.factory";
import { factMetricFactory } from "../factories/FactMetric.factory";

// Persisted watermarks are JavaScript Dates (millisecond precision) while
// warehouse timestamps usually carry microseconds. Every incremental filter
// that continues from a watermark must start at the next millisecond instead
// of using a strict `>` on the truncated value; otherwise the rows inside the
// watermark's last millisecond are loaded again on every refresh.

const watermark = new Date("2024-01-10T12:00:00.999Z");
const NEXT_MS = "'2024-01-10 12:00:01.000'";

const factTable = factTableFactory.build({
  id: "ft_events",
  sql: "SELECT * FROM events",
  userIdTypes: ["user_id"],
});
const factTableMap = new Map([["ft_events", factTable]]);

const sumMetric = factMetricFactory.build({
  id: "fact_sum",
  metricType: "mean",
  numerator: { factTableId: "ft_events", column: "amount", aggregation: "sum" },
});
const raMetric = factMetricFactory.build({
  id: "fact_ra",
  metricType: "mean",
  numerator: { factTableId: "ft_events", column: "amount", aggregation: "sum" },
  regressionAdjustmentEnabled: true,
});

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
  regressionAdjustmentEnabled: true,
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

describe("afterWatermark", () => {
  it("starts from the millisecond after the watermark", () => {
    expect(afterWatermark("m.timestamp", watermark)).toBe(
      `m.timestamp >= ${NEXT_MS}`,
    );
  });
});

describe("incremental refresh watermark filters", () => {
  let integration: BigQuery;

  beforeEach(() => {
    // @ts-expect-error -- context not needed for this unit test
    integration = new BigQuery("", {
      settings: { queries: { exposure: [exposureQuery] } },
    });
  });

  it("units query starts new exposures at the millisecond after the watermark", () => {
    const sql = integration.getUpdateExperimentIncrementalUnitsQuery({
      settings,
      exposureQuery: resolvedExposureQuery,
      activationMetric: null,
      dimensions: [],
      factTableMap,
      segment: null,
      unitsTableFullName: "proj.ds.units",
      unitsTempTableFullName: "proj.ds.units_tmp",
      incrementalRefreshStartTime: new Date("2024-01-15"),
      lastMaxTimestamp: watermark,
    });
    expect(sql).toContain(`e.timestamp >= ${NEXT_MS}`);
    expect(sql).not.toMatch(/e\.timestamp > '/);
  });

  it("metric source insert starts fact table rows at the millisecond after the watermark", () => {
    const sql = integration.getInsertMetricSourceDataQuery({
      settings,
      exposureQuery: resolvedExposureQuery,
      activationMetric: null,
      factTableMap,
      factTableId: "ft_events",
      metricSourceTableFullName: "proj.ds.metric_source",
      unitsSourceTableFullName: "proj.ds.units",
      metrics: [sumMetric],
      lastMaxTimestamp: watermark,
      incrementalRefreshStartTime: settings.endDate,
    });
    expect(sql).toContain(`m.timestamp >= ${NEXT_MS}`);
    expect(sql).not.toMatch(/m\.timestamp > '/);
  });

  it("metric source insert keeps the inclusive start date when there is no binding watermark", () => {
    const build = (lastMaxTimestamp: Date | null) =>
      integration.getInsertMetricSourceDataQuery({
        settings,
        exposureQuery: resolvedExposureQuery,
        activationMetric: null,
        factTableMap,
        factTableId: "ft_events",
        metricSourceTableFullName: "proj.ds.metric_source",
        unitsSourceTableFullName: "proj.ds.units",
        metrics: [sumMetric],
        lastMaxTimestamp,
        incrementalRefreshStartTime: settings.endDate,
      });
    // No watermark at all, or one older than the experiment start: the scan
    // begins at the (inclusive) start date exactly as before.
    for (const sql of [build(null), build(new Date("2023-12-01"))]) {
      expect(sql).toMatch(/m\.timestamp >= '2024-01-01 00:00:00'/);
      expect(sql).not.toContain("2023-12-01");
    }
  });

  it("covariate inserts select units from the millisecond after the watermark", () => {
    const params = {
      settings,
      exposureQuery: resolvedExposureQuery,
      activationMetric: null,
      factTableMap,
      factTableId: "ft_events",
      metricSourceCovariateTableFullName: "proj.ds.cov",
      unitsSourceTableFullName: "proj.ds.units",
      metrics: [raMetric],
      lastCovariateSuccessfulMaxTimestamp: watermark,
    };
    const legacy = integration.getInsertMetricSourceCovariateDataQuery({
      ...params,
      alignLegacyScanToDailyGrain: false,
    });
    const aggregated =
      integration.getInsertMetricSourceCovariateFromAggregatedFactTableQuery({
        ...params,
        aggregatedTableFullName: "proj.ds.agg",
        idType: "user_id",
      });
    for (const sql of [legacy, aggregated]) {
      expect(sql).toContain(`max_timestamp >= ${NEXT_MS}`);
      expect(sql).not.toMatch(/max_timestamp > '/);
    }
  });
});

describe("aggregated fact table incremental insert", () => {
  const params = {
    factTable,
    idType: "user_id",
    metrics: [sumMetric],
    tableFullName: "proj.ds.agg",
    windowStartDate: watermark,
    windowEndDate: null,
  };

  it("starts the incremental slice at the millisecond after the watermark", () => {
    const sql = getInsertAggregatedFactTableDataQuery(bigQueryDialect, {
      ...params,
      exclusiveStart: true,
    });
    expect(sql).toContain(`m.timestamp >= ${NEXT_MS}`);
    expect(sql).not.toMatch(/m\.timestamp > '/);
  });

  it("keeps the inclusive window start for a restate", () => {
    const sql = getInsertAggregatedFactTableDataQuery(bigQueryDialect, {
      ...params,
      exclusiveStart: false,
    });
    expect(sql).toContain("m.timestamp >= '2024-01-10 12:00:00'");
    expect(sql).not.toContain("12:00:01");
  });
});
