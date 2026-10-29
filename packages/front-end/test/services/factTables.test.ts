import { DetectedColumn } from "shared/types/fact-table";
import { SchemaWithPath } from "shared/types/integrations";
import {
  findColumnByName,
  getRemappedUserIdColumns,
  rematchUserIdColumns,
  GA4_EVENTS_TEMPLATE,
  getColumnMappingError,
  getDefaultPartitionColumn,
  getDefaultTimestampColumn,
  getPartitionFormats,
  getPickerTableColumns,
  getPickerTableName,
  getPickerTableSql,
  isPseudoColumn,
} from "@/services/factTables";
import {
  getSchemaBrowserTables,
  getUnlistedTable,
} from "@/services/schemaBrowserTables";

const cols = (...datatypes: DetectedColumn["datatype"][]): DetectedColumn[] =>
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

describe("getUnlistedTable", () => {
  it("names a typed path by its last two parts", () => {
    expect(getUnlistedTable("`proj.marts.orders`")).toMatchObject({
      id: "",
      path: "`proj.marts.orders`",
      schemaName: "marts",
      tableName: "orders",
    });
    expect(getUnlistedTable("orders")).toMatchObject({
      schemaName: "",
      tableName: "orders",
    });
  });
});

describe("getPickerTableSql", () => {
  const start = `'{{date startDateISO "yyyy-MM-dd"}}'`;
  const datePartition = (column: string) => ({
    column,
    datatype: "date" as const,
    format: "",
  });

  it("uses the GA4 template for a GA4 events export only", () => {
    const [events, users] = getSchemaBrowserTables(GA4, true);
    expect(GA4_EVENTS_TEMPLATE.matches(events)).toBe(true);
    expect(GA4_EVENTS_TEMPLATE.matches(users)).toBe(false);
    expect(GA4_EVENTS_TEMPLATE.getSql(events, "")).toContain(
      "FROM\n  `proj.analytics_123.events_*`",
    );
    expect(getPickerTableName(events, GA4_EVENTS_TEMPLATE)).toBe("GA4 Events");
  });

  it("adds only a lower bound on the partition column", () => {
    expect(
      getPickerTableSql(tracks, {
        partition: datePartition("_PARTITIONTIME"),
        datasourceType: "bigquery",
      }),
    ).toBe(
      `SELECT * FROM \`proj.segment.tracks\`\nWHERE\n  _PARTITIONTIME >= ${start}`,
    );
  });

  it("uses a DATE literal for Athena", () => {
    expect(
      getPickerTableSql(tracks, {
        partition: datePartition("event_date"),
        datasourceType: "athena",
      }),
    ).toContain(`event_date >= DATE ${start}`);
  });

  it("quotes a partition column that needs it", () => {
    expect(
      getPickerTableSql(tracks, {
        partition: datePartition("Order Date"),
        identifierQuote: "`",
      }),
    ).toContain(`\`Order Date\` >= ${start}`);
  });

  it("renders the start in a string or number partition's own format", () => {
    expect(
      getPickerTableSql(tracks, {
        partition: { column: "dt", datatype: "string", format: "yyyy-MM" },
      }),
    ).toContain(`dt >= '{{date startDateISO "yyyy-MM"}}'`);
    expect(
      getPickerTableSql(tracks, {
        partition: { column: "day", datatype: "number", format: "yyyyMMdd" },
      }),
    ).toContain(`day >= {{date startDateISO "yyyyMMdd"}}`);
  });

  it("keeps the intraday OR grouped when adding the partition filter", () => {
    const [events] = getSchemaBrowserTables(
      schema("marts", "events_20240101", "events_intraday_20240102"),
      true,
    );
    expect(
      getPickerTableSql(events, { partition: datePartition("ts") }),
    ).toMatch(
      /WHERE\n {2}\(\(_TABLE_SUFFIX .*\) OR \(_TABLE_SUFFIX .*'intraday_.*\)\)\n {2}AND ts >= /,
    );
  });

  it("appends row filters after the pruning filters", () => {
    expect(getPickerTableSql(tracks, { rowFilterWhere: "(x = 1)" })).toBe(
      "SELECT * FROM `proj.segment.tracks`\nWHERE\n  (x = 1)",
    );
    expect(
      getPickerTableSql(tracks, {
        partition: datePartition("_PARTITIONTIME"),
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
    const sql = GA4_EVENTS_TEMPLATE.getSql(events, "(x = 1)");
    expect(sql).toMatch(/^SELECT\n {2}TIMESTAMP_MICROS/);
    expect(sql).toMatch(/_TABLE_SUFFIX .*\n {2}AND \(x = 1\)$/);
  });
});

describe("getDefaultPartitionColumn", () => {
  it("prefers a partitioned timestamp, then BigQuery's _PARTITIONDATE", () => {
    expect(
      getDefaultPartitionColumn(
        [col("dt", "varchar", true), col("event_date", "DATE", true)],
        "athena",
      ),
    ).toBe("event_date");
    expect(
      getDefaultPartitionColumn(
        [
          col("_PARTITIONTIME", "TIMESTAMP", true),
          col("_PARTITIONDATE", "DATE"),
          col("created_at", "TIMESTAMP"),
        ],
        "bigquery",
      ),
    ).toBe("_PARTITIONDATE");
  });

  it("leaves hourly, monthly and yearly ingestion-time tables unfiltered", () => {
    expect(
      getDefaultPartitionColumn(
        [col("_PARTITIONTIME", "TIMESTAMP", true), col("ts", "TIMESTAMP")],
        "bigquery",
      ),
    ).toBe("");
  });

  it("never picks a string partition, whose format is unknown", () => {
    expect(getDefaultPartitionColumn([col("dt", "varchar", true)])).toBe("");
  });
});

describe("getPartitionFormats", () => {
  it("offers only formats the column type can hold", () => {
    expect(getPartitionFormats("date")).toEqual([]);
    expect(getPartitionFormats("number")).toEqual([
      "yyyyMMdd",
      "yyyyMM",
      "yyyy",
    ]);
    expect(getPartitionFormats("string")).toContain("yyyy-MM-dd");
  });
});

describe("isPseudoColumn", () => {
  it("matches BigQuery's reserved prefixes on BigQuery only", () => {
    const names = [
      "_PARTITIONTIME",
      "_PARTITIONDATE",
      "_FILE_NAME",
      "_partition",
      "_table_id",
      "ts",
      "partition_date",
    ];
    expect(
      names.filter((name) => isPseudoColumn(col(name, "STRING"), "bigquery")),
    ).toEqual([
      "_PARTITIONTIME",
      "_PARTITIONDATE",
      "_FILE_NAME",
      "_partition",
      "_table_id",
    ]);
    expect(
      names.filter((name) => isPseudoColumn(col(name, "STRING"), "snowflake")),
    ).toEqual([]);
  });
});

describe("getPickerTableColumns", () => {
  it("lists every column GA4's query returns, in order", () => {
    const [events] = getSchemaBrowserTables(GA4, true);
    const selected = GA4_EVENTS_TEMPLATE.getSql(events, "")
      .split("\nFROM")[0]
      .split(",\n")
      .map((line) => line.trim().match(/(\w+)$/)?.[1]);
    expect(GA4_EVENTS_TEMPLATE.columns.map((c) => c.column)).toEqual(selected);
  });

  it("maps a plain table's information schema types", () => {
    expect(
      getPickerTableColumns([col("ts", "TIMESTAMP"), col("user_id", "STRING")]),
    ).toEqual([
      { column: "ts", datatype: "date" },
      { column: "user_id", datatype: "string" },
    ]);
  });

  it("rules a table out only on known types", () => {
    const error = (...columns: ReturnType<typeof col>[]) =>
      getColumnMappingError(getPickerTableColumns(columns), true);
    expect(error(col("user_id", "STRING"), col("amount", "NUMERIC"))).toBe(
      "Selected table does not have a timestamp column.",
    );
    expect(
      error(col("user_id", "STRING"), col("ts", "SOME_CUSTOM_TYPE")),
    ).toBeNull();
  });
});

describe("getDefaultTimestampColumn", () => {
  const detected = (...names: string[]): DetectedColumn[] =>
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

describe("findColumnByName", () => {
  it("prefers an exact match over looser ones", () => {
    expect(findColumnByName(cols("", "", ""), "c1")).toBe("c1");
    const named = ["userId", "user_id_2", "user_id"].map((column) => ({
      column,
      datatype: "string" as const,
    }));
    expect(findColumnByName(named, "user_id")).toBe("user_id");
    expect(findColumnByName(named, "USER_ID")).toBe("user_id");
    expect(findColumnByName(named.slice(0, 2), "user_id")).toBe("userId");
  });
});

describe("rematchUserIdColumns", () => {
  const columns = ["uid", "anonymous_id", "device_id"].map((column) => ({
    column,
    datatype: "string" as const,
  }));

  it("keeps a mapping whose column still exists", () => {
    expect(
      rematchUserIdColumns({ user_id: "uid" }, ["user_id"], columns),
    ).toEqual({ user_id: "uid" });
  });

  it("re-matches by name when the mapped column is gone", () => {
    expect(
      rematchUserIdColumns({ anonymous_id: "anon" }, ["anonymous_id"], columns),
    ).toEqual({ anonymous_id: "anonymous_id" });
  });

  it("drops identifiers with no matching column", () => {
    expect(
      rematchUserIdColumns({ user_id: "gone" }, ["user_id"], columns),
    ).toEqual({});
  });
});

describe("getRemappedUserIdColumns", () => {
  it("stores only identifiers whose column isn't their own name", () => {
    expect(
      getRemappedUserIdColumns(["user_id", "anonymous_id"], {
        user_id: "user_id",
        anonymous_id: "device_id",
      }),
    ).toEqual({ anonymous_id: "device_id" });
  });
});
