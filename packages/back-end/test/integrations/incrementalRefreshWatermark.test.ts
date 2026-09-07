import { ExperimentSnapshotSettings } from "shared/types/experiment-snapshot";
import { ExposureQuery } from "shared/types/datasource";
import BigQuery from "back-end/src/integrations/BigQuery";
import { bigQueryDialect } from "back-end/src/integrations/dialects/bigquery";
import { snowflakeDialect } from "back-end/src/integrations/dialects/snowflake";
import { prestoDialect } from "back-end/src/integrations/dialects/presto";
import { baseDialect } from "back-end/src/integrations/dialects/base";
import {
  afterWatermark,
  rawWatermark,
} from "back-end/src/integrations/sql/primitives/watermark";
import { getAggregatedFactTableMaxTimestampQuery } from "back-end/src/integrations/sql/queries/aggregated-fact-table-max-timestamp-query";
import { getInsertAggregatedFactTableDataQuery } from "back-end/src/integrations/sql/queries/insert-aggregated-fact-table-data-query";
import { factTableFactory } from "../factories/FactTable.factory";
import { factMetricFactory } from "../factories/FactMetric.factory";

// Persisted watermarks are JavaScript Dates (millisecond precision) while
// warehouse timestamps usually carry microseconds. The watermark query asks
// the warehouse to also print the value at full precision; when that came back
// we persist it alongside the Date and filter with a plain `>` on it.
// Otherwise every incremental filter that continues from a watermark must
// start at the next millisecond instead of using a strict `>` on the truncated
// value; otherwise the rows inside the watermark's last millisecond are loaded
// again on every refresh.

const watermark = new Date("2024-01-10T12:00:00.999Z");
const NEXT_MS = "'2024-01-10 12:00:01.000'";
const RAW = "2024-01-10 12:00:00.999999";
const AFTER_RAW = `> CAST('${RAW}' AS TIMESTAMP)`;

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

describe("formatTimestampExact", () => {
  // The exact value is produced by the warehouse, not parsed from the driver,
  // so each supported dialect spells out its full precision. Anything else
  // yields NULL: a plausible-looking truncated string would silently re-load
  // the watermark's last millisecond on every refresh.
  it("is spelled out per dialect at full precision", () => {
    expect(bigQueryDialect.formatTimestampExact("MAX(t)")).toBe(
      'format_timestamp("%F %H:%M:%E6S", MAX(t))',
    );
    expect(snowflakeDialect.formatTimestampExact("MAX(t)")).toBe(
      "TO_VARCHAR(MAX(t), 'YYYY-MM-DD HH24:MI:SS.FF9')",
    );
    expect(prestoDialect.formatTimestampExact("MAX(t)")).toBe(
      "cast(MAX(t) as varchar)",
    );
    expect(baseDialect.formatTimestampExact("MAX(t)")).toBe("NULL");
  });

  it("is selected alongside every watermark", () => {
    // @ts-expect-error -- context not needed for this unit test
    const bq = new BigQuery("", { settings: {} });
    const exact = 'format_timestamp("%F %H:%M:%E6S", MAX(max_timestamp))';
    for (const sql of [
      bq.getMaxTimestampIncrementalUnitsQuery({
        unitsTableFullName: "proj.ds.units",
        lastMaxTimestamp: null,
      }),
      bq.getMaxTimestampMetricSourceQuery({
        metricSourceTableFullName: "proj.ds.ms",
        lastMaxTimestamp: null,
      }),
      getAggregatedFactTableMaxTimestampQuery(bigQueryDialect, {
        tableFullName: "proj.ds.agg",
        scanStartDate: new Date("2024-01-01"),
      }),
    ]) {
      expect(sql).toContain("MAX(max_timestamp) AS max_timestamp");
      expect(sql).toContain(`${exact} AS max_timestamp_raw`);
    }
  });
});

describe("rawWatermark", () => {
  it("keeps the exact value when it agrees with the Date", () => {
    expect(rawWatermark(watermark, RAW)).toBe(RAW);
    // Snowflake prints nine digits.
    expect(rawWatermark(watermark, `${RAW}000`)).toBe(`${RAW}000`);
  });

  it("drops a value that is not the same millisecond as the Date", () => {
    // The two columns disagree, e.g. rendered in another zone.
    expect(rawWatermark(watermark, "2024-01-10 13:00:00.999999")).toBeNull();
    expect(rawWatermark(watermark, "2024-01-10 12:00:00.998999")).toBeNull();
  });

  it("is null for missing or malformed values", () => {
    expect(rawWatermark(null, RAW)).toBeNull();
    for (const bad of [null, undefined, "", 42, "2024-01-10T12:00:00.999Z"]) {
      expect(rawWatermark(watermark, bad)).toBeNull();
    }
  });
});

describe("afterWatermark", () => {
  it("compares strictly against the exact value when it is known", () => {
    expect(afterWatermark(bigQueryDialect, "m.timestamp", watermark, RAW)).toBe(
      `m.timestamp ${AFTER_RAW}`,
    );
  });

  it("starts from the millisecond after the watermark otherwise", () => {
    expect(afterWatermark(bigQueryDialect, "m.timestamp", watermark)).toBe(
      `m.timestamp >= ${NEXT_MS}`,
    );
    expect(
      afterWatermark(bigQueryDialect, "m.timestamp", watermark, null),
    ).toBe(`m.timestamp >= ${NEXT_MS}`);
  });

  it("ignores a raw value that is not a canonical literal body", () => {
    // Only the shape formatTimestampExact produces is interpolated.
    for (const bad of ["2024-01-10T12:00:00.999999Z", "1' OR '1'='1", ""]) {
      expect(
        afterWatermark(bigQueryDialect, "m.timestamp", watermark, bad),
      ).toBe(`m.timestamp >= ${NEXT_MS}`);
    }
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

  const unitsSql = (lastMaxTimestampRaw: string | null) =>
    integration.getUpdateExperimentIncrementalUnitsQuery({
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
      lastMaxTimestampRaw,
    });

  it("units query starts new exposures at the millisecond after the watermark", () => {
    const sql = unitsSql(null);
    expect(sql).toContain(`e.timestamp >= ${NEXT_MS}`);
    expect(sql).not.toMatch(/e\.timestamp > '/);
  });

  it("units query uses the exact watermark when known", () => {
    const sql = unitsSql(RAW);
    expect(sql).toContain(`e.timestamp ${AFTER_RAW}`);
    expect(sql).not.toContain(NEXT_MS);
  });

  const metricSourceSql = (lastMaxTimestampRaw: string | null) =>
    integration.getInsertMetricSourceDataQuery({
      settings,
      exposureQuery: resolvedExposureQuery,
      activationMetric: null,
      factTableMap,
      factTableId: "ft_events",
      metricSourceTableFullName: "proj.ds.metric_source",
      unitsSourceTableFullName: "proj.ds.units",
      metrics: [sumMetric],
      lastMaxTimestamp: watermark,
      lastMaxTimestampRaw,
      incrementalRefreshStartTime: settings.endDate,
    });

  it("metric source insert starts fact table rows at the millisecond after the watermark", () => {
    const sql = metricSourceSql(null);
    expect(sql).toContain(`m.timestamp >= ${NEXT_MS}`);
    expect(sql).not.toMatch(/m\.timestamp > '/);
  });

  it("metric source insert uses the exact watermark when known", () => {
    const sql = metricSourceSql(RAW);
    expect(sql).toContain(`m.timestamp ${AFTER_RAW}`);
    expect(sql).not.toContain(NEXT_MS);
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
    // begins at the (inclusive) start date exactly as before, and a raw
    // value for a non-binding watermark is ignored.
    for (const sql of [build(null), build(new Date("2023-12-01"))]) {
      expect(sql).toMatch(/m\.timestamp >= '2024-01-01 00:00:00'/);
      expect(sql).not.toContain("2023-12-01");
    }
    expect(
      integration.getInsertMetricSourceDataQuery({
        settings,
        exposureQuery: resolvedExposureQuery,
        activationMetric: null,
        factTableMap,
        factTableId: "ft_events",
        metricSourceTableFullName: "proj.ds.metric_source",
        unitsSourceTableFullName: "proj.ds.units",
        metrics: [sumMetric],
        lastMaxTimestamp: new Date("2023-12-01"),
        lastMaxTimestampRaw: "2023-12-01 00:00:00.000",
        incrementalRefreshStartTime: settings.endDate,
      }),
    ).not.toContain("2023-12-01");
  });

  const covariateSqls = (
    lastCovariateSuccessfulMaxTimestampRaw: string | null,
  ) => {
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
      lastCovariateSuccessfulMaxTimestampRaw,
    };
    return [
      integration.getInsertMetricSourceCovariateDataQuery({
        ...params,
        alignLegacyScanToDailyGrain: false,
      }),
      integration.getInsertMetricSourceCovariateFromAggregatedFactTableQuery({
        ...params,
        aggregatedTableFullName: "proj.ds.agg",
        idType: "user_id",
      }),
    ];
  };

  it("covariate inserts select units from the millisecond after the watermark", () => {
    for (const sql of covariateSqls(null)) {
      expect(sql).toContain(`max_timestamp >= ${NEXT_MS}`);
      expect(sql).not.toMatch(/max_timestamp > '/);
    }
  });

  it("covariate inserts use the exact watermark when known", () => {
    for (const sql of covariateSqls(RAW)) {
      expect(sql).toContain(`max_timestamp ${AFTER_RAW}`);
      expect(sql).not.toContain(NEXT_MS);
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
    windowEndDate: new Date("2024-01-15"),
  };

  it("starts the incremental slice at the millisecond after the watermark", () => {
    const sql = getInsertAggregatedFactTableDataQuery(bigQueryDialect, {
      ...params,
      exclusiveStart: true,
    });
    expect(sql).toContain(`m.timestamp >= ${NEXT_MS}`);
    expect(sql).not.toMatch(/m\.timestamp > '/);
  });

  it("starts the incremental slice at the exact watermark when known", () => {
    const sql = getInsertAggregatedFactTableDataQuery(bigQueryDialect, {
      ...params,
      exclusiveStart: true,
      windowStartDateRaw: RAW,
    });
    expect(sql).toContain(`m.timestamp ${AFTER_RAW}`);
    expect(sql).not.toContain(NEXT_MS);
  });

  it("keeps the inclusive window start for a restate", () => {
    const sql = getInsertAggregatedFactTableDataQuery(bigQueryDialect, {
      ...params,
      exclusiveStart: false,
      // The runner never passes one for a restate, but it must be inert anyway.
      windowStartDateRaw: RAW,
    });
    expect(sql).toContain("m.timestamp >= '2024-01-10 12:00:00'");
    expect(sql).not.toContain("12:00:01");
    expect(sql).not.toContain(RAW);
  });
});
