import {
  formatBigQueryEventForwarderDestination,
  formatSnowflakeEventForwarderDestination,
  parseBigQueryEventForwarderDestination,
  parseSnowflakeEventForwarderDestination,
} from "../../src/util/event-forwarder-destination";
import {
  normalizeSnowflakeEventForwarderAccessUrl,
  tryDeriveSnowflakeAccessUrlFromAccount,
} from "../../src/util/event-forwarder-snowflake-url";

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
