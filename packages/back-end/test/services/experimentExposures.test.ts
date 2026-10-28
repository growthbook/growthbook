import { z } from "zod";
import { experimentExposureRecordValidator } from "shared/validators";
import {
  coerceValue,
  getColumn,
  getExposuresCacheKey,
  MAX_EXTRA_COLUMNS,
  MAX_VALUE_LENGTH,
  normalizeTimestamp,
  shapeExposureRows,
  type ExposuresWindow,
} from "back-end/src/services/experiment-exposures";

const base = {
  identifierColumn: "user_id",
  timestampColumn: "timestamp",
  variationIdColumn: "variation_id",
  dimensions: ["country"],
  caseSensitive: false,
};

describe("normalizeTimestamp", () => {
  it("treats a naive timestamp as UTC", () => {
    expect(normalizeTimestamp("2025-01-01 12:00:00")).toBe(
      "2025-01-01T12:00:00.000Z",
    );
  });

  it("preserves an explicit zone", () => {
    expect(normalizeTimestamp("2025-01-01T12:00:00+05:30")).toBe(
      "2025-01-01T06:30:00.000Z",
    );
  });

  it("passes through unparseable input", () => {
    expect(normalizeTimestamp("not a date")).toBe("not a date");
  });

  it("handles Date objects", () => {
    expect(normalizeTimestamp(new Date("2025-01-01T00:00:00Z"))).toBe(
      "2025-01-01T00:00:00.000Z",
    );
  });
});

describe("coerceValue", () => {
  it("coerces scalars to strings and nullish to null", () => {
    expect(coerceValue(5)).toBe("5");
    expect(coerceValue(true)).toBe("true");
    expect(coerceValue(BigInt(9))).toBe("9");
    expect(coerceValue(null)).toBeNull();
    expect(coerceValue(undefined)).toBeNull();
  });

  it("serializes objects and truncates long values", () => {
    expect(coerceValue({ a: 1 })).toBe('{"a":1}');
    const long = "x".repeat(MAX_VALUE_LENGTH + 50);
    const out = coerceValue(long) as string;
    expect(out).toHaveLength(MAX_VALUE_LENGTH + 1);
    expect(out.endsWith("…")).toBe(true);
  });
});

describe("getColumn", () => {
  it("matches case-insensitively when the warehouse folds identifiers", () => {
    expect(getColumn({ countrycode: "US" }, "countryCode", false)).toBe("US");
    expect(getColumn({ COUNTRYCODE: "US" }, "countryCode", false)).toBe("US");
  });

  it("requires an exact match when identifiers are case sensitive", () => {
    expect(
      getColumn({ countrycode: "US" }, "countryCode", true),
    ).toBeUndefined();
  });
});

describe("shapeExposureRows", () => {
  it("splits declared dimensions from extra columns", () => {
    const { records, extraColumns } = shapeExposureRows({
      ...base,
      rows: [
        {
          timestamp: "2025-01-01 00:00:00",
          user_id: "u1",
          variation_id: "0",
          country: "US",
          experiment_id: "exp",
          browser: "chrome",
        },
      ],
    });

    expect(extraColumns).toEqual(["experiment_id", "browser"]);
    expect(records[0].dimensions).toEqual({ country: "US" });
    // Everything the query returned beyond the typed fields, so the expanded
    // row can show the complete record.
    expect(records[0].extra).toEqual({
      experiment_id: "exp",
      browser: "chrome",
    });
  });

  it("reads typed fields from mapped columns", () => {
    const { records, extraColumns } = shapeExposureRows({
      ...base,
      identifierColumn: "uid",
      timestampColumn: "received_at",
      variationIdColumn: "variant",
      rows: [
        {
          received_at: "2025-01-01 00:00:00",
          uid: "u1",
          variant: "1",
          country: "US",
        },
      ],
    });
    expect(records[0]).toMatchObject({ userId: "u1", variationId: "1" });
    expect(records[0].timestamp).toContain("2025-01-01");
    expect(extraColumns).toEqual([]);
  });

  it("resolves dimensions the warehouse lower-cased", () => {
    const { records } = shapeExposureRows({
      ...base,
      dimensions: ["countryCode"],
      rows: [
        {
          timestamp: "2025-01-01 00:00:00",
          user_id: "u1",
          variation_id: "0",
          countrycode: "US",
        },
      ],
    });
    expect(records[0].dimensions).toEqual({ countryCode: "US" });
  });

  it("does not let a warehouse column shadow a typed field", () => {
    // Regression: the previous implementation spread the raw row over the
    // coerced fields, so raw values leaked back into timestamp/userId.
    const { records } = shapeExposureRows({
      ...base,
      rows: [
        {
          timestamp: "2025-01-01 00:00:00",
          user_id: 42,
          variation_id: 1,
          country: null,
        },
      ],
    });
    expect(records[0].timestamp).toBe("2025-01-01T00:00:00.000Z");
    expect(records[0].userId).toBe("42");
    expect(records[0].variationId).toBe("1");
    expect(records[0].dimensions.country).toBeNull();
  });

  it("caps the number of extra columns", () => {
    const row: Record<string, unknown> = {
      timestamp: "2025-01-01 00:00:00",
      user_id: "u1",
      variation_id: "0",
      country: "US",
    };
    for (let i = 0; i < MAX_EXTRA_COLUMNS + 10; i++) row[`col${i}`] = i;

    const { extraColumns, records } = shapeExposureRows({
      ...base,
      rows: [row],
    });
    expect(extraColumns).toHaveLength(MAX_EXTRA_COLUMNS);
    expect(Object.keys(records[0].extra)).toHaveLength(MAX_EXTRA_COLUMNS);
  });

  it("reports a shortened filterable value", () => {
    const long = "x".repeat(MAX_VALUE_LENGTH + 1);
    const row = {
      timestamp: "2025-01-01 00:00:00",
      user_id: "u1",
      variation_id: "0",
      country: "US",
    };

    expect(shapeExposureRows({ ...base, rows: [row] }).valuesTruncated).toBe(
      false,
    );
    expect(
      shapeExposureRows({ ...base, rows: [{ ...row, country: long }] })
        .valuesTruncated,
    ).toBe(true);
    expect(
      shapeExposureRows({ ...base, rows: [{ ...row, user_id: long }] })
        .valuesTruncated,
    ).toBe(true);
    // `extra` is never filtered on, so a long value there is harmless.
    expect(
      shapeExposureRows({ ...base, rows: [{ ...row, payload: long }] })
        .valuesTruncated,
    ).toBe(false);
  });

  it("produces records matching the shared validator", () => {
    const { records } = shapeExposureRows({
      ...base,
      rows: [
        {
          timestamp: new Date("2025-01-01T00:00:00Z"),
          user_id: null,
          variation_id: "0",
          country: "US",
          payload: { nested: true },
          count: BigInt(3),
        },
      ],
    });
    expect(() =>
      z.array(experimentExposureRecordValidator).parse(records),
    ).not.toThrow();
    expect(records[0].userId).toBeNull();
  });
});

describe("getExposuresCacheKey", () => {
  const DAY_MS = 24 * 60 * 60 * 1000;
  const rolling = (windowMs: number): ExposuresWindow => ({
    kind: "rolling",
    windowMs,
  });
  const base = {
    experimentId: "exp_123",
    experimentTrackingKey: "my-experiment",
    exposureQueryId: "eq_1",
    exposureQuerySql: "SELECT * FROM exposures",
    identifierType: "user_id",
    columnMapping: {},
    dimensions: ["country"],
    window: rolling(DAY_MS),
    rowFilters: [],
    limit: 1000,
  };

  it("ignores where a rolling window sits, which is the whole point", () => {
    // The generated SQL embeds minute-snapped dates, so a rolling 24h window
    // produces a different string every minute and never hits the cache twice.
    expect(getExposuresCacheKey(base)).toBe(getExposuresCacheKey({ ...base }));
  });

  it("ignores sub-minute jitter in the window length", () => {
    expect(
      getExposuresCacheKey({ ...base, window: rolling(DAY_MS + 400) }),
    ).toBe(getExposuresCacheKey(base));
  });

  it("separates windows of different lengths", () => {
    expect(
      getExposuresCacheKey({ ...base, window: rolling(7 * DAY_MS) }),
    ).not.toBe(getExposuresCacheKey(base));
  });

  it("separates a fixed day from the rolling window of the same length", () => {
    // Yesterday and the default rolling day are both 24 hours long, so without
    // this a Health tab asking for the default would be served yesterday.
    const fixed = {
      ...base,
      window: {
        kind: "fixed" as const,
        startDate: new Date("2025-01-01T00:00:00Z"),
        endDate: new Date("2025-01-02T00:00:00Z"),
      },
    };
    expect(getExposuresCacheKey(fixed)).not.toBe(getExposuresCacheKey(base));
  });

  it("separates fixed windows at different points in history", () => {
    const fixedFrom = (day: string) => ({
      ...base,
      window: {
        kind: "fixed" as const,
        startDate: new Date(`${day}T00:00:00Z`),
        endDate: new Date(`${day}T12:00:00Z`),
      },
    });
    expect(getExposuresCacheKey(fixedFrom("2025-01-01"))).not.toBe(
      getExposuresCacheKey(fixedFrom("2025-02-01")),
    );
  });

  it("separates runs that compile under a different phase", () => {
    // The rolling key is time-insensitive, so a `cache: "required"` read is
    // matched on this hash alone. Without the phase it would serve rows the
    // exposure query built for a different phase.
    expect(getExposuresCacheKey({ ...base, phase: { index: "1" } })).not.toBe(
      getExposuresCacheKey({ ...base, phase: { index: "0" } }),
    );
  });

  it("separates runs that compile with different custom fields", () => {
    expect(
      getExposuresCacheKey({ ...base, customFields: { region: "us" } }),
    ).not.toBe(
      getExposuresCacheKey({ ...base, customFields: { region: "eu" } }),
    );
  });

  it("separates a filtered run from an unfiltered one", () => {
    // This is what lets the panel show cached rows beside an empty filter
    // panel: an unfiltered probe can only ever match an unfiltered run.
    expect(
      getExposuresCacheKey({
        ...base,
        rowFilters: [{ column: "country", operator: "=", values: ["US"] }],
      }),
    ).not.toBe(getExposuresCacheKey(base));
  });

  it("separates runs differing only in filter value", () => {
    const withValue = (v: string) =>
      getExposuresCacheKey({
        ...base,
        rowFilters: [{ column: "country", operator: "=", values: [v] }],
      });
    expect(withValue("US")).not.toBe(withValue("GB"));
  });

  it("separates experiments, dimensions, and an edited exposure query", () => {
    expect(getExposuresCacheKey({ ...base, experimentId: "exp_456" })).not.toBe(
      getExposuresCacheKey(base),
    );
    expect(
      getExposuresCacheKey({ ...base, dimensions: ["country", "browser"] }),
    ).not.toBe(getExposuresCacheKey(base));
    expect(
      getExposuresCacheKey({ ...base, exposureQuerySql: "SELECT 1" }),
    ).not.toBe(getExposuresCacheKey(base));
  });
});
