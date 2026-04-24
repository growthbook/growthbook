import {
  DEFAULT_EVENT_FORWARDER_BIGQUERY_TABLE_NAME,
  isValidBigQueryTableName,
  normalizeBigQueryTableNameForEventForwarder,
} from "../../src/util/bigquery-table-name";

describe("normalizeBigQueryTableNameForEventForwarder", () => {
  it("returns default when raw is empty", () => {
    expect(normalizeBigQueryTableNameForEventForwarder("")).toBe(
      DEFAULT_EVENT_FORWARDER_BIGQUERY_TABLE_NAME,
    );
    expect(normalizeBigQueryTableNameForEventForwarder("   ")).toBe(
      DEFAULT_EVENT_FORWARDER_BIGQUERY_TABLE_NAME,
    );
  });

  it("maps hyphens and spaces to underscores", () => {
    expect(normalizeBigQueryTableNameForEventForwarder("gb-events")).toBe(
      "gb_events",
    );
    expect(normalizeBigQueryTableNameForEventForwarder("gb events")).toBe(
      "gb_events",
    );
  });

  it("prefixes when the first character would be a digit", () => {
    expect(normalizeBigQueryTableNameForEventForwarder("42foo")).toBe("_42foo");
  });

  it("preserves unicode letters", () => {
    expect(normalizeBigQueryTableNameForEventForwarder("événements")).toBe(
      "événements",
    );
  });

  it("throws when there are no letters or digits", () => {
    expect(() => normalizeBigQueryTableNameForEventForwarder("___")).toThrow(
      /letter or number/,
    );
    expect(() => normalizeBigQueryTableNameForEventForwarder("---")).toThrow(
      /letter or number/,
    );
  });
});

describe("isValidBigQueryTableName", () => {
  it("accepts unicode letters and underscores", () => {
    expect(isValidBigQueryTableName("gb_events")).toBe(true);
    expect(isValidBigQueryTableName("événements")).toBe(true);
    expect(isValidBigQueryTableName("_42")).toBe(true);
  });

  it("rejects hyphens", () => {
    expect(isValidBigQueryTableName("gb-events")).toBe(false);
  });
});
