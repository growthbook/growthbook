import {
  DEFAULT_EVENT_FORWARDER_BIGQUERY_TABLE_NAME,
  DEFAULT_EVENT_FORWARDER_SNOWFLAKE_TABLE_NAME,
  formatBigQueryEventForwarderDestination,
  formatSnowflakeEventForwarderDestination,
  isValidBigQueryTableName,
  isValidSnowflakeTableName,
  normalizeBigQueryTableNameForEventForwarder,
  normalizeSnowflakeEventForwarderAccessUrl,
  normalizeSnowflakeTableNameForEventForwarder,
  parseBigQueryEventForwarderDestination,
  parseSnowflakeEventForwarderDestination,
  tryDeriveSnowflakeAccessUrlFromAccount,
} from "../../src/util/event-forwarder-destination";

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

describe("parseBigQueryEventForwarderDestination", () => {
  it("parses dataset.table", () => {
    expect(
      parseBigQueryEventForwarderDestination("analytics_123.gb_events"),
    ).toEqual({
      dataset: "analytics_123",
      table: "gb_events",
    });
  });

  it("parses project.dataset.table", () => {
    expect(
      parseBigQueryEventForwarderDestination("my-project.my_dataset.gb_events"),
    ).toEqual({
      projectId: "my-project",
      dataset: "my_dataset",
      table: "gb_events",
    });
  });

  it("unwraps backticks", () => {
    expect(
      parseBigQueryEventForwarderDestination(
        "`my-project`.my_dataset.gb_events",
      ),
    ).toEqual({
      projectId: "my-project",
      dataset: "my_dataset",
      table: "gb_events",
    });
  });

  it("rejects invalid segment counts", () => {
    expect(() => parseBigQueryEventForwarderDestination("only_table")).toThrow(
      /dataset\.table/,
    );
    expect(() => parseBigQueryEventForwarderDestination("a.b.c.d")).toThrow(
      /dataset\.table/,
    );
  });
});

describe("formatBigQueryEventForwarderDestination", () => {
  it("round-trips two-part paths", () => {
    const destination = { dataset: "analytics_123", table: "gb_events" };
    expect(
      parseBigQueryEventForwarderDestination(
        formatBigQueryEventForwarderDestination(destination),
      ),
    ).toEqual(destination);
  });
});

describe("parseSnowflakeEventForwarderDestination", () => {
  it("parses DATABASE.SCHEMA.TABLE and normalizes identifiers", () => {
    expect(
      parseSnowflakeEventForwarderDestination(
        "event_forwarder_db.public.gb-events",
      ),
    ).toEqual({
      database: "EVENT_FORWARDER_DB",
      schema: "PUBLIC",
      table: "GB_EVENTS",
    });
  });

  it("rejects wrong segment count", () => {
    expect(() => parseSnowflakeEventForwarderDestination("DB.SCHEMA")).toThrow(
      /three dot-separated/,
    );
  });
});

describe("formatSnowflakeEventForwarderDestination", () => {
  it("round-trips three-part paths", () => {
    const destination = {
      database: "EVENT_FORWARDER_DB",
      schema: "PUBLIC",
      table: "GB_EVENTS",
    };
    expect(
      parseSnowflakeEventForwarderDestination(
        formatSnowflakeEventForwarderDestination(destination),
      ),
    ).toEqual(destination);
  });
});

describe("tryDeriveSnowflakeAccessUrlFromAccount", () => {
  it("derives modern org-account URL without adding region", () => {
    expect(tryDeriveSnowflakeAccessUrlFromAccount("myorg-myaccount")).toBe(
      "https://myorg-myaccount.snowflakecomputing.com",
    );
  });

  it("derives legacy URL when region is already in account", () => {
    expect(
      tryDeriveSnowflakeAccessUrlFromAccount("xy12345.us-east-2.aws"),
    ).toBe("https://xy12345.us-east-2.aws.snowflakecomputing.com");
  });

  it("does not derive from bare locator", () => {
    expect(tryDeriveSnowflakeAccessUrlFromAccount("xy12345")).toBeNull();
  });

  it("does not derive from bare locator with underscore suffix", () => {
    expect(tryDeriveSnowflakeAccessUrlFromAccount("xy12345_extra")).toBeNull();
  });

  it("maps underscores to hyphens in hostname", () => {
    expect(tryDeriveSnowflakeAccessUrlFromAccount("myorg_myaccount")).toBe(
      "https://myorg-myaccount.snowflakecomputing.com",
    );
  });
});

describe("normalizeSnowflakeEventForwarderAccessUrl", () => {
  it("preserves modern URL hostname", () => {
    expect(
      normalizeSnowflakeEventForwarderAccessUrl(
        "https://myorg-account123.snowflakecomputing.com",
      ),
    ).toBe("https://myorg-account123.snowflakecomputing.com");
  });

  it("preserves legacy URL with region", () => {
    expect(
      normalizeSnowflakeEventForwarderAccessUrl(
        "https://xy12345.us-east-1.aws.snowflakecomputing.com:443",
      ),
    ).toBe("https://xy12345.us-east-1.aws.snowflakecomputing.com");
  });

  it("adds https when missing", () => {
    expect(
      normalizeSnowflakeEventForwarderAccessUrl(
        "myorg-account123.snowflakecomputing.com",
      ),
    ).toBe("https://myorg-account123.snowflakecomputing.com");
  });

  it("rejects non-snowflake hostnames", () => {
    expect(() =>
      normalizeSnowflakeEventForwarderAccessUrl("https://example.com"),
    ).toThrow(/snowflakecomputing\.com/);
  });
});
