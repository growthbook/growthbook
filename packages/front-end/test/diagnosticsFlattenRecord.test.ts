import { describe, expect, it } from "vitest";
import { flattenRecord } from "@/components/Diagnostics/types";

interface Row {
  timestamp: string;
  userId: string | null;
  dimensions: Record<string, string | null>;
  extra: Record<string, string | null>;
}

const row: Row = {
  timestamp: "2025-01-01T00:00:00.000Z",
  userId: "u1",
  dimensions: { country: "US" },
  extra: { browser: "chrome" },
};

describe("flattenRecord", () => {
  it("lifts named wrappers to the top level", () => {
    expect(
      flattenRecord(row, { flattenKeys: ["dimensions", "extra"] }),
    ).toEqual({
      timestamp: "2025-01-01T00:00:00.000Z",
      userId: "u1",
      country: "US",
      browser: "chrome",
    });
  });

  it("keeps fields that columns already display", () => {
    const result = flattenRecord(row, {
      flattenKeys: ["dimensions", "extra"],
    });
    // The detail view is the complete record, not a leftovers bag.
    expect(result).toHaveProperty("timestamp");
    expect(result).toHaveProperty("userId");
  });

  it("leaves nested objects intact when not named", () => {
    expect(flattenRecord(row)).toEqual(row);
  });

  it("does not flatten a null or array value", () => {
    const odd = { a: null, b: ["x"], dimensions: { country: "US" } };
    expect(
      flattenRecord(odd, { flattenKeys: ["dimensions", "a", "b"] }),
    ).toEqual({ a: null, b: ["x"], country: "US" });
  });
});
