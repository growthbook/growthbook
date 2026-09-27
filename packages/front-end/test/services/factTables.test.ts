import { DetectedFactTableColumn } from "shared/types/fact-table";
import { SchemaWithPath } from "shared/types/integrations";
import {
  getColumnMappingError,
  getDefaultTimestampColumn,
  getPartitionFilterColumn,
  getPickerTableError,
  getPickerTableName,
  getPickerTableSql,
} from "@/services/factTables";
import { getSchemaBrowserTables } from "@/services/schemaBrowserTables";

const cols = (
  ...datatypes: DetectedFactTableColumn["datatype"][]
): DetectedFactTableColumn[] =>
  datatypes.map((datatype, i) => ({ column: `c${i}`, datatype }));

describe("getColumnMappingError", () => {
  it("accepts a date plus an identifier candidate", () => {
    expect(getColumnMappingError(cols("date", "string"))).toBeNull();
    expect(getColumnMappingError(cols("other", "number"))).toBeNull();
    expect(getColumnMappingError(cols("", ""))).toBeNull();
    expect(
      getColumnMappingError(cols("date", "boolean", "json", "")),
    ).toBeNull();
  });

  it("rejects a query with no timestamp candidate", () => {
    expect(getColumnMappingError(cols("string", "number"))).toMatch(
      /date column/,
    );
  });

  it("rejects a query with no identifier candidate", () => {
    expect(getColumnMappingError(cols("date", "boolean"))).toMatch(
      /identifier/,
    );
  });

  it("rejects a single unknown column serving as both", () => {
    expect(getColumnMappingError(cols(""))).toMatch(/separate/);
  });
});

const schema = (schemaName: string, ...names: string[]): SchemaWithPath => ({
  schemaName,
  path: `\`proj.${schemaName}`,
  dateCreated: new Date(),
  dateUpdated: new Date(),
  tables: names.map((tableName) => ({
    tableName,
    id: `id-${tableName}`,
    path: `\`proj.${schemaName}.${tableName}\``,
    numOfColumns: 3,
    dateCreated: new Date(),
    dateUpdated: new Date(),
  })),
});

const GA4 = schema(
  "analytics_123",
  "events_20240101",
  "events_20240102",
  "events_intraday_20240103",
  "pseudonymous_users_20240101",
  "pseudonymous_users_20240102",
);

const [tracks] = getSchemaBrowserTables(schema("segment", "tracks"), true);

const col = (columnName: string, dataType: string, isPartition = false) => ({
  columnName,
  dataType,
  isPartition,
});

describe("getSchemaBrowserTables", () => {
  it("collapses date-sharded tables into one wildcard row per prefix", () => {
    const tables = getSchemaBrowserTables(GA4, true);
    expect(tables.map((t) => t.tableName)).toEqual([
      "events_*",
      "pseudonymous_users_*",
    ]);
    expect(tables[0]).toMatchObject({
      id: "id-events_20240102",
      path: "`proj.analytics_123.events_*`",
      shards: 3,
      hasIntraday: true,
    });
    expect(tables[1]).toMatchObject({ shards: 2, hasIntraday: false });
  });

  it("leaves plain tables and lone dated tables alone", () => {
    const tables = getSchemaBrowserTables(
      schema("marts", "orders", "backup_20240101"),
      true,
    );
    expect(tables.map((t) => [t.tableName, t.shards])).toEqual([
      ["orders", undefined],
      ["backup_20240101", undefined],
    ]);
  });
});

describe("getPickerTableSql", () => {
  const start = `'{{date startDateISO "yyyy-MM-dd"}}'`;

  it("uses the GA4 query for a GA4 events export only", () => {
    const [events, users] = getSchemaBrowserTables(GA4, true);
    expect(getPickerTableSql(events)).toContain(
      "FROM\n  `proj.analytics_123.events_*`",
    );
    expect(getPickerTableName(events)).toBe("GA4 Events");
    expect(getPickerTableSql(users)).toMatch(/^SELECT \* FROM/);
  });

  it("adds only a lower bound on the partition column", () => {
    expect(
      getPickerTableSql(tracks, {
        partitionColumn: "_PARTITIONTIME",
        datasourceType: "bigquery",
      }),
    ).toBe(
      `SELECT * FROM \`proj.segment.tracks\`\nWHERE\n  _PARTITIONTIME >= ${start}`,
    );
  });

  it("uses a DATE literal for Athena", () => {
    expect(
      getPickerTableSql(tracks, {
        partitionColumn: "event_date",
        datasourceType: "athena",
      }),
    ).toContain(`event_date >= DATE ${start}`);
  });

  it("keeps the intraday OR grouped when adding the partition filter", () => {
    const [events] = getSchemaBrowserTables(
      schema("marts", "events_20240101", "events_intraday_20240102"),
      true,
    );
    expect(getPickerTableSql(events, { partitionColumn: "ts" })).toMatch(
      /WHERE\n {2}\(\(_TABLE_SUFFIX .*\) OR \(_TABLE_SUFFIX .*'intraday_.*\)\)\n {2}AND ts >= /,
    );
  });

  it("appends row filters after the pruning filters", () => {
    expect(getPickerTableSql(tracks, { rowFilterWhere: "(x = 1)" })).toBe(
      "SELECT * FROM `proj.segment.tracks`\nWHERE\n  (x = 1)",
    );
    expect(
      getPickerTableSql(tracks, {
        partitionColumn: "_PARTITIONTIME",
        rowFilterWhere: "(x = 1)",
      }),
    ).toMatch(/_PARTITIONTIME >= .*\n {2}AND \(x = 1\)$/);
  });

  it("lists selected columns, quoting only the ones that need it", () => {
    expect(
      getPickerTableSql(tracks, {
        columns: ["user_id", "Order Date"],
        identifierQuote: "`",
      }),
    ).toBe("SELECT\n  user_id,\n  `Order Date`\nFROM `proj.segment.tracks`");
  });

  it("filters GA4's hand-written query but keeps its columns", () => {
    const [events] = getSchemaBrowserTables(GA4, true);
    const sql = getPickerTableSql(events, {
      columns: ["x"],
      rowFilterWhere: "(x = 1)",
    });
    expect(sql).toMatch(/^SELECT\n {2}TIMESTAMP_MICROS/);
    expect(sql).toMatch(/_TABLE_SUFFIX .*\n {2}AND \(x = 1\)$/);
  });
});

describe("getPartitionFilterColumn", () => {
  it("picks only a date-typed partition column", () => {
    expect(
      getPartitionFilterColumn([
        col("created_at", "TIMESTAMP"),
        col("dt", "varchar", true),
        col("_PARTITIONTIME", "TIMESTAMP", true),
      ]),
    ).toBe("_PARTITIONTIME");
    expect(getPartitionFilterColumn([col("dt", "varchar", true)])).toBe("");
  });
});

describe("getPickerTableError", () => {
  it("rules a table out only on known types", () => {
    expect(
      getPickerTableError(tracks, [
        col("user_id", "STRING"),
        col("amount", "NUMERIC"),
      ]),
    ).toBe("Selected table does not have a timestamp column.");
    expect(
      getPickerTableError(tracks, [
        col("user_id", "STRING"),
        col("ts", "SOME_CUSTOM_TYPE"),
      ]),
    ).toBeNull();
  });

  it("checks the selected columns once the table itself is usable", () => {
    const columns = [col("user_id", "STRING"), col("ts", "TIMESTAMP")];
    expect(getPickerTableError(tracks, columns, ["user_id"])).toMatch(
      /^Selected columns must include/,
    );
    expect(getPickerTableError(tracks, columns, ["ts", "user_id"])).toBeNull();
    expect(getPickerTableError(tracks, columns, [])).toBeNull();
  });

  it("skips the check for GA4, whose query builds its own columns", () => {
    const [events] = getSchemaBrowserTables(GA4, true);
    expect(
      getPickerTableError(events, [col("event_timestamp", "INT64")]),
    ).toBeNull();
  });
});

describe("getDefaultTimestampColumn", () => {
  const detected = (...names: string[]): DetectedFactTableColumn[] =>
    names.map((column) => ({
      column,
      datatype: column.endsWith("_id") ? "string" : "date",
    }));

  it("prefers a tracker's own timestamp, case-insensitively", () => {
    expect(
      getDefaultTimestampColumn(
        detected("anonymous_id", "loaded_at", "sent_at", "RECEIVED_AT"),
      ),
    ).toBe("RECEIVED_AT");
  });

  it("falls back to the first date column", () => {
    expect(
      getDefaultTimestampColumn(
        detected("user_id", "created_at", "updated_at"),
      ),
    ).toBe("created_at");
  });
});
