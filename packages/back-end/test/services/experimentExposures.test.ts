import { z } from "zod";
import { experimentExposureRecordValidator } from "shared/validators";
import {
  coerceValue,
  getColumn,
  MAX_EXTRA_COLUMNS,
  MAX_VALUE_LENGTH,
  normalizeTimestamp,
  shapeExposureRows,
} from "back-end/src/services/experiment-exposures";

const base = {
  userIdType: "user_id",
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
