import {
  getMetricSettingsHashForAggregatedFactTable,
  getFactTableSettingsHashForAggregatedFactTable,
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
