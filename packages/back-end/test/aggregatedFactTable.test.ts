import { getAutoSliceMetrics, isSliceMetric } from "shared/experiments";
import {
  buildAggregatedFactTableSchemaState,
  detectAggregatedFactTableSchemaDrift,
  getAggregatedFactTableRestateReason,
  getMetricSettingsHashForAggregatedFactTable,
  getFactTableSettingsHashForAggregatedFactTable,
} from "back-end/src/enterprise/services/data-pipeline";
import { getAggregatedFactTableSchema } from "back-end/src/integrations/sql/fact-metrics/aggregated-fact-table-schema";
import { encodeMetricIdForColumnName } from "back-end/src/integrations/sql/fact-metrics/encode-metric-id-for-column-name";
import { getColumnsForMetric } from "back-end/src/integrations/sql/fact-metrics/columns-for-metric";
import {
  parseAggregatedFactTableCoverage,
  foldAggregatedFactTableCoverage,
} from "back-end/src/queryRunners/AggregatedFactTableQueryRunner";
import { getAggregatedFactTableMetrics } from "back-end/src/services/aggregatedFactTables";
import { bigQueryDialect } from "back-end/src/integrations/dialects/bigquery";
import { factMetricFactory } from "./factories/FactMetric.factory";
import { factTableFactory } from "./factories/FactTable.factory";

const FT_ID = "ft_target";
const OTHER_FT_ID = "ft_other";

describe("getMetricSettingsHashForAggregatedFactTable", () => {
  it("is stable for identical metrics", () => {
    const a = factMetricFactory.build({
      id: "m1",
      metricType: "mean",
      numerator: { factTableId: FT_ID, column: "value", aggregation: "sum" },
    });
    const b = factMetricFactory.build({
      id: "m2",
      metricType: "mean",
      numerator: { factTableId: FT_ID, column: "value", aggregation: "sum" },
    });
    expect(
      getMetricSettingsHashForAggregatedFactTable({
        factMetric: a,
        factTableId: FT_ID,
      }),
    ).toEqual(
      getMetricSettingsHashForAggregatedFactTable({
        factMetric: b,
        factTableId: FT_ID,
      }),
    );
  });

  it("changes when the metric type changes", () => {
    const base = factMetricFactory.build({
      metricType: "mean",
      numerator: { factTableId: FT_ID, column: "value", aggregation: "sum" },
    });
    const changed = factMetricFactory.build({
      ...base,
      metricType: "proportion",
    });
    expect(
      getMetricSettingsHashForAggregatedFactTable({
        factMetric: base,
        factTableId: FT_ID,
      }),
    ).not.toEqual(
      getMetricSettingsHashForAggregatedFactTable({
        factMetric: changed,
        factTableId: FT_ID,
      }),
    );
  });

  it("changes when the numerator column/aggregation changes", () => {
    const base = factMetricFactory.build({
      metricType: "mean",
      numerator: { factTableId: FT_ID, column: "value", aggregation: "sum" },
    });
    const changedColumn = factMetricFactory.build({
      ...base,
      numerator: { factTableId: FT_ID, column: "amount", aggregation: "sum" },
    });
    const changedAgg = factMetricFactory.build({
      ...base,
      numerator: { factTableId: FT_ID, column: "value", aggregation: "max" },
    });
    const baseHash = getMetricSettingsHashForAggregatedFactTable({
      factMetric: base,
      factTableId: FT_ID,
    });
    expect(baseHash).not.toEqual(
      getMetricSettingsHashForAggregatedFactTable({
        factMetric: changedColumn,
        factTableId: FT_ID,
      }),
    );
    expect(baseHash).not.toEqual(
      getMetricSettingsHashForAggregatedFactTable({
        factMetric: changedAgg,
        factTableId: FT_ID,
      }),
    );
  });

  it("ignores non-schema-breaking changes (capping)", () => {
    const base = factMetricFactory.build({
      metricType: "mean",
      numerator: { factTableId: FT_ID, column: "value", aggregation: "sum" },
    });
    const capped = factMetricFactory.build({
      ...base,
      cappingSettings: { type: "absolute", value: 100, ignoreZeros: false },
    });
    expect(
      getMetricSettingsHashForAggregatedFactTable({
        factMetric: base,
        factTableId: FT_ID,
      }),
    ).toEqual(
      getMetricSettingsHashForAggregatedFactTable({
        factMetric: capped,
        factTableId: FT_ID,
      }),
    );
  });

  it("ignores numerator changes when the fact table only owns the denominator", () => {
    const base = factMetricFactory.build({
      metricType: "ratio",
      numerator: {
        factTableId: OTHER_FT_ID,
        column: "value",
        aggregation: "sum",
      },
      denominator: { factTableId: FT_ID, column: "value", aggregation: "sum" },
    });
    const changedNumerator = factMetricFactory.build({
      ...base,
      numerator: {
        factTableId: OTHER_FT_ID,
        column: "amount",
        aggregation: "max",
      },
    });
    // FT_ID only owns the denominator column, so numerator changes must not
    // affect the hash for this fact table.
    expect(
      getMetricSettingsHashForAggregatedFactTable({
        factMetric: base,
        factTableId: FT_ID,
      }),
    ).toEqual(
      getMetricSettingsHashForAggregatedFactTable({
        factMetric: changedNumerator,
        factTableId: FT_ID,
      }),
    );
  });
});

describe("getFactTableSettingsHashForAggregatedFactTable", () => {
  it("is stable for identical definitions and id-type order", () => {
    const a = factTableFactory.build({
      sql: "SELECT * FROM events",
      eventName: "purchase",
      userIdTypes: ["user_id", "anonymous_id"],
    });
    const b = factTableFactory.build({
      sql: "SELECT * FROM events",
      eventName: "purchase",
      userIdTypes: ["anonymous_id", "user_id"],
    });
    expect(getFactTableSettingsHashForAggregatedFactTable(a)).toEqual(
      getFactTableSettingsHashForAggregatedFactTable(b),
    );
  });

  it("changes when the SQL changes", () => {
    const a = factTableFactory.build({ sql: "SELECT * FROM events" });
    const b = factTableFactory.build({ sql: "SELECT * FROM events_v2" });
    expect(getFactTableSettingsHashForAggregatedFactTable(a)).not.toEqual(
      getFactTableSettingsHashForAggregatedFactTable(b),
    );
  });

  it("changes when filters change", () => {
    const a = factTableFactory.build({ filters: [] });
    const b = factTableFactory.build({
      filters: [
        {
          id: "flt_1",
          name: "high value",
          description: "",
          value: "amount > 100",
          dateCreated: new Date(),
          dateUpdated: new Date(),
          managedBy: "",
        },
      ],
    });
    expect(getFactTableSettingsHashForAggregatedFactTable(a)).not.toEqual(
      getFactTableSettingsHashForAggregatedFactTable(b),
    );
  });
});

describe("getAggregatedFactTableMetrics", () => {
  it("excludes archived fact-metrics", () => {
    const factTable = factTableFactory.build({ id: FT_ID });
    const active = factMetricFactory.build({
      numerator: { factTableId: FT_ID, column: "value", aggregation: "sum" },
    });
    const archived = factMetricFactory.build({
      archived: true,
      numerator: { factTableId: FT_ID, column: "gone", aggregation: "sum" },
    });
    const metrics = getAggregatedFactTableMetrics({
      factMetrics: [active, archived],
      factTable,
    });
    expect(metrics.map((m) => m.id)).toEqual([active.id]);
  });
});

describe("getAggregatedFactTableSchema", () => {
  const idType = "user_id";

  it("includes the fixed columns keyed on the id type", () => {
    const metric = factMetricFactory.build({
      metricType: "mean",
      numerator: { factTableId: FT_ID, column: "value", aggregation: "sum" },
    });
    const schema = getAggregatedFactTableSchema(bigQueryDialect, {
      idType,
      factTableId: FT_ID,
      metrics: [metric],
    });
    expect(schema.has(idType)).toBe(true);
    expect(schema.has("event_date")).toBe(true);
    expect(schema.has("insertion_timestamp")).toBe(true);
    expect(schema.has("max_timestamp")).toBe(true);
  });

  it("emits a value column for a mean metric on this fact table", () => {
    const metric = factMetricFactory.build({
      metricType: "mean",
      numerator: { factTableId: FT_ID, column: "value", aggregation: "sum" },
    });
    const enc = encodeMetricIdForColumnName(metric.id);
    const schema = getAggregatedFactTableSchema(bigQueryDialect, {
      idType,
      factTableId: FT_ID,
      metrics: [metric],
    });
    expect(schema.has(`${enc}_value`)).toBe(true);
    expect(schema.has(`${enc}_denominator_value`)).toBe(false);
  });

  it("emits both value and denominator columns for a ratio metric on this fact table", () => {
    const metric = factMetricFactory.build({
      metricType: "ratio",
      numerator: { factTableId: FT_ID, column: "value", aggregation: "sum" },
      denominator: { factTableId: FT_ID, column: "count", aggregation: "sum" },
    });
    const enc = encodeMetricIdForColumnName(metric.id);
    const schema = getAggregatedFactTableSchema(bigQueryDialect, {
      idType,
      factTableId: FT_ID,
      metrics: [metric],
    });
    expect(schema.has(`${enc}_value`)).toBe(true);
    expect(schema.has(`${enc}_denominator_value`)).toBe(true);
  });

  it("only emits the denominator column when the fact table owns just the denominator", () => {
    const metric = factMetricFactory.build({
      metricType: "ratio",
      numerator: {
        factTableId: OTHER_FT_ID,
        column: "value",
        aggregation: "sum",
      },
      denominator: { factTableId: FT_ID, column: "count", aggregation: "sum" },
    });
    const enc = encodeMetricIdForColumnName(metric.id);
    const schema = getAggregatedFactTableSchema(bigQueryDialect, {
      idType,
      factTableId: FT_ID,
      metrics: [metric],
    });
    expect(schema.has(`${enc}_value`)).toBe(false);
    expect(schema.has(`${enc}_denominator_value`)).toBe(true);
  });
});

describe("getColumnsForMetric", () => {
  it("returns the value column for a mean metric", () => {
    const metric = factMetricFactory.build({
      metricType: "mean",
      numerator: { factTableId: FT_ID, column: "value", aggregation: "sum" },
    });
    const enc = encodeMetricIdForColumnName(metric.id);
    expect(getColumnsForMetric(metric, FT_ID)).toEqual([`${enc}_value`]);
  });

  it("returns value + denominator for a ratio metric on this fact table", () => {
    const metric = factMetricFactory.build({
      metricType: "ratio",
      numerator: { factTableId: FT_ID, column: "value", aggregation: "sum" },
      denominator: { factTableId: FT_ID, column: "count", aggregation: "sum" },
    });
    const enc = encodeMetricIdForColumnName(metric.id);
    expect(getColumnsForMetric(metric, FT_ID).sort()).toEqual(
      [`${enc}_value`, `${enc}_denominator_value`].sort(),
    );
  });

  it("returns only the denominator column when the fact table owns just the denominator", () => {
    const metric = factMetricFactory.build({
      metricType: "ratio",
      numerator: {
        factTableId: OTHER_FT_ID,
        column: "value",
        aggregation: "sum",
      },
      denominator: { factTableId: FT_ID, column: "count", aggregation: "sum" },
    });
    const enc = encodeMetricIdForColumnName(metric.id);
    expect(getColumnsForMetric(metric, FT_ID)).toEqual([
      `${enc}_denominator_value`,
    ]);
  });

  it("includes an n_events column for an event quantile metric", () => {
    // The factory hardcodes quantileSettings to null, so set it post-build.
    const metric = {
      ...factMetricFactory.build({
        metricType: "quantile",
        numerator: { factTableId: FT_ID, column: "value", aggregation: "sum" },
      }),
      quantileSettings: {
        quantile: 0.5,
        type: "event" as const,
        ignoreZeros: false,
      },
    };
    const enc = encodeMetricIdForColumnName(metric.id);
    expect(getColumnsForMetric(metric, FT_ID).sort()).toEqual(
      [`${enc}_value`, `${enc}_n_events`].sort(),
    );
  });
});

describe("parseAggregatedFactTableCoverage", () => {
  it("parses a populated coverage row", () => {
    const result = parseAggregatedFactTableCoverage({
      max_timestamp: "2024-01-10T12:00:00Z",
      first_event_date: "2024-01-01",
      last_event_date: "2024-01-10",
    });
    expect(result.lastMaxTimestamp).toEqual(new Date("2024-01-10T12:00:00Z"));
    expect(result.firstEventDate).toEqual(new Date("2024-01-01"));
    expect(result.lastEventDate).toEqual(new Date("2024-01-10"));
  });

  it("returns all-null coverage for an empty/missing row", () => {
    expect(parseAggregatedFactTableCoverage(undefined)).toEqual({
      lastMaxTimestamp: null,
      firstEventDate: null,
      lastEventDate: null,
    });
    expect(
      parseAggregatedFactTableCoverage({
        max_timestamp: null,
        first_event_date: null,
        last_event_date: null,
      }),
    ).toEqual({
      lastMaxTimestamp: null,
      firstEventDate: null,
      lastEventDate: null,
    });
  });

  it("treats unparseable dates as null", () => {
    const result = parseAggregatedFactTableCoverage({
      max_timestamp: "not-a-date",
      first_event_date: "2024-01-01",
    });
    expect(result.lastMaxTimestamp).toBeNull();
    expect(result.firstEventDate).toEqual(new Date("2024-01-01"));
    expect(result.lastEventDate).toBeNull();
  });
});

describe("foldAggregatedFactTableCoverage", () => {
  const date = (s: string) => new Date(s);

  it("uses the scanned values verbatim on a restate (whole window re-scanned)", () => {
    const scanned = {
      lastMaxTimestamp: date("2024-02-01T00:00:00Z"),
      firstEventDate: date("2024-01-02"),
      lastEventDate: date("2024-02-01"),
    };
    const folded = foldAggregatedFactTableCoverage({
      scanned,
      mode: "restate",
      // Prior values must be ignored on a restate.
      prior: {
        lastMaxTimestamp: date("2099-01-01T00:00:00Z"),
        firstEventDate: date("2000-01-01"),
        lastEventDate: date("2099-01-01"),
      },
      retentionFloor: date("2024-01-01"),
    });
    expect(folded).toEqual(scanned);
  });

  it("advances the watermark and last event date monotonically on incremental", () => {
    const folded = foldAggregatedFactTableCoverage({
      scanned: {
        lastMaxTimestamp: date("2024-02-10T06:00:00Z"),
        firstEventDate: date("2024-02-05"), // within-window min, not the global first
        lastEventDate: date("2024-02-10"),
      },
      mode: "incremental",
      prior: {
        lastMaxTimestamp: date("2024-02-05T00:00:00Z"),
        firstEventDate: date("2024-01-01"),
        lastEventDate: date("2024-02-05"),
      },
      retentionFloor: date("2023-12-13"),
    });
    expect(folded.lastMaxTimestamp).toEqual(date("2024-02-10T06:00:00Z"));
    expect(folded.lastEventDate).toEqual(date("2024-02-10"));
  });

  it("never lets the watermark/last event date regress when the slice is empty", () => {
    const folded = foldAggregatedFactTableCoverage({
      scanned: {
        lastMaxTimestamp: null,
        firstEventDate: null,
        lastEventDate: null,
      },
      mode: "incremental",
      prior: {
        lastMaxTimestamp: date("2024-02-05T00:00:00Z"),
        firstEventDate: date("2024-01-01"),
        lastEventDate: date("2024-02-05"),
      },
      retentionFloor: date("2023-12-13"),
    });
    expect(folded.lastMaxTimestamp).toEqual(date("2024-02-05T00:00:00Z"));
    expect(folded.lastEventDate).toEqual(date("2024-02-05"));
  });

  it("pins firstEventDate to the retention floor once the table is older than the window", () => {
    // Prior firstEventDate is older than the retention floor (those partitions
    // have since expired), so we must report the newer floor, never the stale
    // earlier date.
    const folded = foldAggregatedFactTableCoverage({
      scanned: {
        lastMaxTimestamp: date("2024-03-01T00:00:00Z"),
        firstEventDate: date("2024-02-28"),
        lastEventDate: date("2024-03-01"),
      },
      mode: "incremental",
      prior: {
        lastMaxTimestamp: date("2024-02-28T00:00:00Z"),
        firstEventDate: date("2024-01-01"),
        lastEventDate: date("2024-02-28"),
      },
      retentionFloor: date("2024-01-15"),
    });
    expect(folded.firstEventDate).toEqual(date("2024-01-15"));
  });

  it("keeps the real earliest while the table is younger than the window", () => {
    // Table only has a few days of data; the retention floor is far in the past,
    // so the real earliest (prior) is the correct, newer value.
    const folded = foldAggregatedFactTableCoverage({
      scanned: {
        lastMaxTimestamp: date("2024-02-04T00:00:00Z"),
        firstEventDate: date("2024-02-03"),
        lastEventDate: date("2024-02-04"),
      },
      mode: "incremental",
      prior: {
        lastMaxTimestamp: date("2024-02-03T00:00:00Z"),
        firstEventDate: date("2024-02-01"),
        lastEventDate: date("2024-02-03"),
      },
      retentionFloor: date("2023-12-06"),
    });
    expect(folded.firstEventDate).toEqual(date("2024-02-01"));
  });

  it("reports no coverage when the incremental slice and prior are both empty", () => {
    const folded = foldAggregatedFactTableCoverage({
      scanned: {
        lastMaxTimestamp: null,
        firstEventDate: null,
        lastEventDate: null,
      },
      mode: "incremental",
      prior: {
        lastMaxTimestamp: null,
        firstEventDate: null,
        lastEventDate: null,
      },
      retentionFloor: date("2023-12-06"),
    });
    expect(folded).toEqual({
      lastMaxTimestamp: null,
      firstEventDate: null,
      lastEventDate: null,
    });
  });
});

describe("buildAggregatedFactTableSchemaState", () => {
  it("stores slices only on base metrics, not on flattened slice-metric entries", () => {
    const factTable = factTableFactory.build({
      id: FT_ID,
      sql: "SELECT * FROM events",
      eventName: "purchase",
      columns: [
        {
          column: "country",
          name: "Country",
          description: "",
          datatype: "string",
          numberFormat: "",
          deleted: false,
          dateCreated: new Date(),
          dateUpdated: new Date(),
          isAutoSliceColumn: true,
          autoSlices: ["US", "UK"],
        },
      ],
    });
    const baseMetric = factMetricFactory.build({
      id: "m1",
      metricType: "mean",
      numerator: { factTableId: FT_ID, column: "value", aggregation: "sum" },
      metricAutoSlices: ["country"],
    });
    const flattenedMetrics = [
      baseMetric,
      ...getAutoSliceMetrics({ metric: baseMetric, factTable }),
    ];

    const { metricState } = buildAggregatedFactTableSchemaState({
      factTable,
      metrics: flattenedMetrics,
    });

    const baseState = metricState.find((m) => m.metricId === baseMetric.id);
    expect(baseState?.slices?.length).toBeGreaterThan(0);
    expect(
      baseState?.slices?.every((slice) =>
        flattenedMetrics.some((metric) => metric.id === slice.metricId),
      ),
    ).toBe(true);

    for (const metric of flattenedMetrics) {
      if (!isSliceMetric(metric)) continue;
      const entry = metricState.find((m) => m.metricId === metric.id);
      expect(entry?.slices).toEqual([]);
    }
  });
});

describe("detectAggregatedFactTableSchemaDrift", () => {
  const factTable = factTableFactory.build({
    id: FT_ID,
    sql: "SELECT * FROM events",
    eventName: "purchase",
  });
  const metricA = factMetricFactory.build({
    id: "m1",
    metricType: "mean",
    numerator: { factTableId: FT_ID, column: "value", aggregation: "sum" },
  });
  const metricB = factMetricFactory.build({
    id: "m2",
    metricType: "mean",
    numerator: { factTableId: FT_ID, column: "count", aggregation: "sum" },
  });

  const buildState = (
    metrics: (typeof metricA)[],
    ft: typeof factTable = factTable,
  ) => buildAggregatedFactTableSchemaState({ factTable: ft, metrics });

  it("reports no drift for identical state", () => {
    const { factTableSettingsHash, metricState } = buildState([metricA]);
    expect(
      detectAggregatedFactTableSchemaDrift({
        registry: {
          tableFullName: "proj.ds.t",
          factTableSettingsHash,
          metricState,
        },
        factTableSettingsHash,
        metricState,
      }).drift,
    ).toBe(false);
  });

  it("detects an added metric", () => {
    const prev = buildState([metricA]);
    const next = buildState([metricA, metricB]);
    expect(
      detectAggregatedFactTableSchemaDrift({
        registry: { tableFullName: "t", ...prev },
        factTableSettingsHash: next.factTableSettingsHash,
        metricState: next.metricState,
      }).drift,
    ).toBe(true);
  });

  it("tolerates a removed metric (orphan column)", () => {
    const prev = buildState([metricA, metricB]);
    const next = buildState([metricA]);
    expect(
      detectAggregatedFactTableSchemaDrift({
        registry: { tableFullName: "t", ...prev },
        factTableSettingsHash: next.factTableSettingsHash,
        metricState: next.metricState,
      }).drift,
    ).toBe(false);
  });

  it("detects a re-added metric after a tolerated removal", () => {
    // The tolerating run persists the reduced metric set to the registry, so
    // re-adding the metric reads as a new addition and must restate.
    const persistedAfterRemoval = buildState([metricA]);
    const next = buildState([metricA, metricB]);
    expect(
      detectAggregatedFactTableSchemaDrift({
        registry: { tableFullName: "t", ...persistedAfterRemoval },
        factTableSettingsHash: next.factTableSettingsHash,
        metricState: next.metricState,
      }).drift,
    ).toBe(true);
  });

  it("tolerates a removed slice", () => {
    const withSlice = buildState([metricA]);
    const prevState = withSlice.metricState.map((m) => ({
      ...m,
      slices: [
        ...(m.slices ?? []),
        { metricId: `${m.metricId}__slice`, columns: ["x"] },
      ],
    }));
    expect(
      detectAggregatedFactTableSchemaDrift({
        registry: {
          tableFullName: "t",
          factTableSettingsHash: withSlice.factTableSettingsHash,
          metricState: prevState,
        },
        factTableSettingsHash: withSlice.factTableSettingsHash,
        metricState: withSlice.metricState,
      }).drift,
    ).toBe(false);
  });

  it("detects a changed metric settingsHash", () => {
    const prev = buildState([metricA]);
    const changed = factMetricFactory.build({
      ...metricA,
      numerator: { factTableId: FT_ID, column: "value", aggregation: "max" },
    });
    const next = buildState([changed]);
    expect(
      detectAggregatedFactTableSchemaDrift({
        registry: { tableFullName: "t", ...prev },
        factTableSettingsHash: next.factTableSettingsHash,
        metricState: next.metricState,
      }).drift,
    ).toBe(true);
  });

  it("detects a fact table definition change", () => {
    const prev = buildState([metricA]);
    const otherFactTable = factTableFactory.build({
      id: FT_ID,
      sql: "SELECT * FROM events_v2",
      eventName: "purchase",
    });
    const next = buildState([metricA], otherFactTable);
    expect(
      detectAggregatedFactTableSchemaDrift({
        registry: { tableFullName: "t", ...prev },
        factTableSettingsHash: next.factTableSettingsHash,
        metricState: next.metricState,
      }).drift,
    ).toBe(true);
  });

  it("detects a changed slice set", () => {
    const { factTableSettingsHash, metricState } = buildState([metricA]);
    const withExtraSlice = metricState.map((m) => ({
      ...m,
      slices: [
        ...(m.slices ?? []),
        { metricId: `${m.metricId}__slice`, columns: ["x"] },
      ],
    }));
    expect(
      detectAggregatedFactTableSchemaDrift({
        registry: { tableFullName: "t", factTableSettingsHash, metricState },
        factTableSettingsHash,
        metricState: withExtraSlice,
      }).drift,
    ).toBe(true);
  });

  it("flags a materialized table with empty metric state (defensive)", () => {
    const { factTableSettingsHash, metricState } = buildState([metricA]);
    expect(
      detectAggregatedFactTableSchemaDrift({
        registry: {
          tableFullName: "t",
          factTableSettingsHash,
          metricState: [],
        },
        factTableSettingsHash,
        metricState,
      }).drift,
    ).toBe(true);
  });
});

describe("getAggregatedFactTableRestateReason", () => {
  const factTable = factTableFactory.build({
    id: FT_ID,
    sql: "SELECT * FROM events",
    eventName: "purchase",
  });
  const metricA = factMetricFactory.build({
    id: "m1",
    metricType: "mean",
    numerator: { factTableId: FT_ID, column: "value", aggregation: "sum" },
  });
  const metricB = factMetricFactory.build({
    id: "m2",
    metricType: "mean",
    numerator: { factTableId: FT_ID, column: "count", aggregation: "sum" },
  });

  const consistent = buildAggregatedFactTableSchemaState({
    factTable,
    metrics: [metricA],
  });
  const drifted = buildAggregatedFactTableSchemaState({
    factTable,
    metrics: [metricA, metricB],
  });

  it("returns incomplete-write when the in-flight marker is set", () => {
    expect(
      getAggregatedFactTableRestateReason({
        registry: {
          tableFullName: "t",
          factTableSettingsHash: consistent.factTableSettingsHash,
          metricState: consistent.metricState,
          inFlightExecutionId: "aftexec_1",
        },
        factTableSettingsHash: consistent.factTableSettingsHash,
        metricState: consistent.metricState,
      }),
    ).toBe("incomplete-write");
  });

  it("prioritizes incomplete-write over schema drift", () => {
    expect(
      getAggregatedFactTableRestateReason({
        registry: {
          tableFullName: "t",
          factTableSettingsHash: consistent.factTableSettingsHash,
          metricState: consistent.metricState,
          inFlightExecutionId: "aftexec_1",
        },
        // a drifting current schema, but the marker takes precedence
        factTableSettingsHash: drifted.factTableSettingsHash,
        metricState: drifted.metricState,
      }),
    ).toBe("incomplete-write");
  });

  it("returns schema-drift on drift with a clean marker", () => {
    expect(
      getAggregatedFactTableRestateReason({
        registry: {
          tableFullName: "t",
          factTableSettingsHash: consistent.factTableSettingsHash,
          metricState: consistent.metricState,
          inFlightExecutionId: null,
        },
        factTableSettingsHash: drifted.factTableSettingsHash,
        metricState: drifted.metricState,
      }),
    ).toBe("schema-drift");
  });

  it("returns null when the table is consistent", () => {
    expect(
      getAggregatedFactTableRestateReason({
        registry: {
          tableFullName: "t",
          factTableSettingsHash: consistent.factTableSettingsHash,
          metricState: consistent.metricState,
          inFlightExecutionId: null,
        },
        factTableSettingsHash: consistent.factTableSettingsHash,
        metricState: consistent.metricState,
      }),
    ).toBeNull();
  });

  it("returns null when the table has never been materialized", () => {
    expect(
      getAggregatedFactTableRestateReason({
        registry: {
          tableFullName: null,
          factTableSettingsHash: consistent.factTableSettingsHash,
          metricState: consistent.metricState,
          // even with a marker set, a never-materialized table is the caller's
          // first-run case, not an incomplete write.
          inFlightExecutionId: "aftexec_1",
        },
        factTableSettingsHash: drifted.factTableSettingsHash,
        metricState: drifted.metricState,
      }),
    ).toBeNull();
  });
});
