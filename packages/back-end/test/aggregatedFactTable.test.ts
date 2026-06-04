import {
  buildAggregatedFactTableSchemaState,
  detectAggregatedFactTableSchemaDrift,
  getAggregatedFactTableRestateReason,
  getMetricSettingsHashForAggregatedFactTable,
  getFactTableSettingsHashForAggregatedFactTable,
  mergeAggregatedFactTableCoverage,
} from "back-end/src/enterprise/services/data-pipeline";
import { getAggregatedFactTableSchema } from "back-end/src/integrations/sql/fact-metrics/aggregated-fact-table-schema";
import { encodeMetricIdForColumnName } from "back-end/src/integrations/sql/fact-metrics/encode-metric-id-for-column-name";
import { getColumnsForMetric } from "back-end/src/integrations/sql/fact-metrics/columns-for-metric";
import { parseAggregatedFactTableCoverage } from "back-end/src/queryRunners/AggregatedFactTableQueryRunner";
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

  it("detects a removed metric", () => {
    const prev = buildState([metricA, metricB]);
    const next = buildState([metricA]);
    expect(
      detectAggregatedFactTableSchemaDrift({
        registry: { tableFullName: "t", ...prev },
        factTableSettingsHash: next.factTableSettingsHash,
        metricState: next.metricState,
      }).drift,
    ).toBe(true);
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

describe("mergeAggregatedFactTableCoverage", () => {
  const d1 = new Date("2024-01-01T00:00:00Z");
  const d2 = new Date("2024-02-01T00:00:00Z");
  const nullCoverage = {
    lastMaxTimestamp: null,
    firstEventDate: null,
    lastEventDate: null,
  };

  it("does not regress a non-null watermark to null", () => {
    const merged = mergeAggregatedFactTableCoverage(
      { lastMaxTimestamp: d2, firstEventDate: d1, lastEventDate: d2 },
      nullCoverage,
    );
    expect(merged.lastMaxTimestamp).toEqual(d2);
    expect(merged.firstEventDate).toEqual(d1);
    expect(merged.lastEventDate).toEqual(d2);
  });

  it("advances to a newer non-null watermark", () => {
    const merged = mergeAggregatedFactTableCoverage(
      { lastMaxTimestamp: d1, firstEventDate: d1, lastEventDate: d1 },
      { lastMaxTimestamp: d2, firstEventDate: d1, lastEventDate: d2 },
    );
    expect(merged.lastMaxTimestamp).toEqual(d2);
    expect(merged.lastEventDate).toEqual(d2);
  });

  it("does not regress to an earlier watermark", () => {
    const merged = mergeAggregatedFactTableCoverage(
      { lastMaxTimestamp: d2, firstEventDate: d1, lastEventDate: d2 },
      { lastMaxTimestamp: d1, firstEventDate: d1, lastEventDate: d1 },
    );
    expect(merged.lastMaxTimestamp).toEqual(d2);
    expect(merged.lastEventDate).toEqual(d2);
  });

  it("extends the first event date earlier as more history is seen", () => {
    const merged = mergeAggregatedFactTableCoverage(
      { lastMaxTimestamp: d2, firstEventDate: d2, lastEventDate: d2 },
      { lastMaxTimestamp: d2, firstEventDate: d1, lastEventDate: d2 },
    );
    expect(merged.firstEventDate).toEqual(d1);
  });

  it("stays null when both prior and parsed are null", () => {
    expect(
      mergeAggregatedFactTableCoverage(nullCoverage, nullCoverage),
    ).toEqual(nullCoverage);
  });

  it("adopts the parsed coverage when the prior is null", () => {
    const merged = mergeAggregatedFactTableCoverage(nullCoverage, {
      lastMaxTimestamp: d1,
      firstEventDate: d1,
      lastEventDate: d1,
    });
    expect(merged.lastMaxTimestamp).toEqual(d1);
    expect(merged.firstEventDate).toEqual(d1);
    expect(merged.lastEventDate).toEqual(d1);
  });
});
