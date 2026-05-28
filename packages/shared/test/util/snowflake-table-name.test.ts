import {
  DEFAULT_EVENT_FORWARDER_SNOWFLAKE_TABLE_NAME,
  isValidSnowflakeTableName,
  normalizeSnowflakeTableNameForEventForwarder,
} from "../../src/util/snowflake-table-name";

describe("normalizeSnowflakeTableNameForEventForwarder", () => {
  it("returns default when raw is empty", () => {
    expect(normalizeSnowflakeTableNameForEventForwarder("")).toBe(
      DEFAULT_EVENT_FORWARDER_SNOWFLAKE_TABLE_NAME,
    );
    expect(normalizeSnowflakeTableNameForEventForwarder("   ")).toBe(
      DEFAULT_EVENT_FORWARDER_SNOWFLAKE_TABLE_NAME,
    );
  });

  it("maps hyphens and spaces to underscores and uppercases", () => {
    expect(normalizeSnowflakeTableNameForEventForwarder("gb-events")).toBe(
      "GB_EVENTS",
    );
    expect(normalizeSnowflakeTableNameForEventForwarder("gb events")).toBe(
      "GB_EVENTS",
    );
  });

  it("prefixes when the first character would be a digit", () => {
    expect(normalizeSnowflakeTableNameForEventForwarder("42foo")).toBe(
      "_42FOO",
    );
  });

  it("allows dollar signs", () => {
    expect(normalizeSnowflakeTableNameForEventForwarder("gb$events")).toBe(
      "GB$EVENTS",
    );
  });

  it("throws when there are no letters or digits", () => {
    expect(() => normalizeSnowflakeTableNameForEventForwarder("___")).toThrow(
      /letter or number/,
    );
    expect(() => normalizeSnowflakeTableNameForEventForwarder("---")).toThrow(
      /letter or number/,
    );
  });
});

describe("isValidSnowflakeTableName", () => {
  it("accepts normalized Snowflake identifiers", () => {
    expect(isValidSnowflakeTableName("GB_EVENTS")).toBe(true);
    expect(isValidSnowflakeTableName("_42")).toBe(true);
    expect(isValidSnowflakeTableName("GB$EVENTS")).toBe(true);
  });

  it("rejects lowercase and hyphens", () => {
    expect(isValidSnowflakeTableName("gb_events")).toBe(false);
    expect(isValidSnowflakeTableName("GB-EVENTS")).toBe(false);
  });
});
