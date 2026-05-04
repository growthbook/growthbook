import { validateContextualAttributesInPayload } from "back-end/src/services/stats";

const ATTRS = [
  { name: "country", column: "country" },
  { name: "device", column: "device" },
];

describe("validateContextualAttributesInPayload", () => {
  it("returns ok when all columns are present and well-populated", () => {
    const rows = Array.from({ length: 100 }).map(() => ({
      country: "US",
      device: "mobile",
    }));
    const out = validateContextualAttributesInPayload(ATTRS, rows);
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.warnings).toBeUndefined();
  });

  it("fails fast when a declared column is missing", () => {
    const rows = [{ country: "US" }];
    const out = validateContextualAttributesInPayload(ATTRS, rows);
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.missingColumns).toEqual(["device"]);
      expect(out.error).toMatch(/missing/i);
    }
  });

  it("warns when null rate exceeds 5%", () => {
    const rows = Array.from({ length: 100 }).map((_, i) => ({
      country: "US",
      device: i < 90 ? "mobile" : null, // 10% null
    }));
    const out = validateContextualAttributesInPayload(ATTRS, rows);
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.warnings).toBeDefined();
      expect(out.warnings?.[0]?.column).toBe("device");
      expect(out.warnings?.[0]?.nullRate).toBeCloseTo(0.1);
    }
  });

  it("does not warn when null rate is within threshold", () => {
    const rows = Array.from({ length: 100 }).map((_, i) => ({
      country: "US",
      device: i < 97 ? "mobile" : null, // 3% null
    }));
    const out = validateContextualAttributesInPayload(ATTRS, rows);
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.warnings).toBeUndefined();
  });

  it("treats empty string as null", () => {
    const rows = Array.from({ length: 20 }).map((_, i) => ({
      country: "US",
      device: i < 10 ? "" : "mobile",
    }));
    const out = validateContextualAttributesInPayload(ATTRS, rows);
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.warnings?.[0]?.column).toBe("device");
  });

  it("excludes deleted attributes", () => {
    const rows = [{ country: "US" }];
    const out = validateContextualAttributesInPayload(
      [
        { name: "country", column: "country" },
        { name: "device", column: "device", deleted: true },
      ],
      rows,
    );
    expect(out.ok).toBe(true);
  });

  it("fails when no active attributes", () => {
    const out = validateContextualAttributesInPayload([], [{}]);
    expect(out.ok).toBe(false);
  });

  it("fails when sample is empty", () => {
    const out = validateContextualAttributesInPayload(ATTRS, []);
    expect(out.ok).toBe(false);
  });
});
