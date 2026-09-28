import { mapDatabaseTypeToEnum } from "shared/enterprise";

describe("mapDatabaseTypeToEnum", () => {
  it.each([
    ["INT64", "number"],
    ["TIMESTAMP", "date"],
    ["BOOL", "boolean"],
    ["character varying", "string"],
    ["LowCardinality(Nullable(String))", "string"],
  ])("maps %s to %s", (input, expected) => {
    expect(mapDatabaseTypeToEnum(input)).toBe(expected);
  });

  // Their inner types would otherwise read as a number or string
  it.each([
    "STRUCT<category STRING, time_zone_offset_seconds INT64>",
    "ARRAY<STRUCT<key STRING, value STRUCT<int_value INT64>>>",
    "Array(String)",
    "Map(String, UInt64)",
    "row(name varchar, age integer)",
    "jsonb",
    "VARIANT",
    "super",
  ])("treats %s as complex", (input) => {
    expect(mapDatabaseTypeToEnum(input)).toBe("other");
  });
});
