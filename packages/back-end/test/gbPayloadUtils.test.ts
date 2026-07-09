import {
  buildAppFeaturesModule,
  buildDefaultPayloadModule,
  sanitizePayload,
} from "back-end/src/scripts/gb-payload.utils";

describe("sanitizePayload", () => {
  it("rejects non-objects and empty payloads", () => {
    expect(() => sanitizePayload(null)).toThrow();
    expect(() => sanitizePayload("nope")).toThrow();
    expect(() => sanitizePayload([])).toThrow();
    expect(() => sanitizePayload({})).toThrow();
    expect(() => sanitizePayload({ features: {} })).toThrow(/zero features/);
    expect(() => sanitizePayload({ features: [] })).toThrow();
  });

  it("keeps features + dateUpdated, drops status and encrypted fields", () => {
    const out = sanitizePayload({
      status: 200,
      features: { b: { defaultValue: true }, a: { defaultValue: 1 } },
      dateUpdated: "2026-07-09T00:00:00.000Z",
      encryptedFeatures: "abc123",
    });
    expect(out).toEqual({
      features: { a: { defaultValue: 1 }, b: { defaultValue: true } },
      dateUpdated: "2026-07-09T00:00:00.000Z",
    });
    expect("status" in out).toBe(false);
    expect("encryptedFeatures" in out).toBe(false);
  });

  it("sorts feature keys for stable diffs", () => {
    const out = sanitizePayload({
      features: { zebra: {}, alpha: {}, "mid-key": {} },
    });
    expect(Object.keys(out.features || {})).toEqual([
      "alpha",
      "mid-key",
      "zebra",
    ]);
  });

  it("keeps savedGroups when present as an object", () => {
    const out = sanitizePayload({
      features: { a: {} },
      savedGroups: { grp_1: ["id1"] },
    });
    expect(out.savedGroups).toEqual({ grp_1: ["id1"] });
  });
});

describe("buildDefaultPayloadModule", () => {
  it("emits a typed module containing the payload", () => {
    const src = buildDefaultPayloadModule({
      features: { a: { defaultValue: 1 } },
      dateUpdated: "2026-07-09T00:00:00.000Z",
    });
    expect(src).toContain(
      'import { FeatureApiResponse } from "@growthbook/growthbook"',
    );
    expect(src).toContain(
      "export const GB_DEFAULT_PAYLOAD: FeatureApiResponse =",
    );
    expect(src).toContain('"defaultValue": 1');
    expect(src).toContain("AUTO-GENERATED");
  });
});

describe("buildAppFeaturesModule", () => {
  it("maps valueTypes, quotes non-identifier keys, sorts, skips archived", () => {
    const src = buildAppFeaturesModule([
      { id: "zeta-flag", valueType: "boolean" },
      { id: "alpha", valueType: "json" },
      { id: "count", valueType: "number" },
      { id: "greeting", valueType: "string" },
      { id: "old-flag", valueType: "boolean", archived: true },
    ]);
    expect(src).toContain("export type AppFeatures = {");
    // sorted + quoting rules
    expect(src.indexOf("alpha:")).toBeLessThan(src.indexOf('"zeta-flag":'));
    expect(src).toContain("alpha: Record<string, unknown>;");
    expect(src).toContain("count: number;");
    expect(src).toContain("greeting: string;");
    expect(src).toContain('"zeta-flag": boolean;');
    expect(src).not.toContain("old-flag");
  });

  it("adds extras only when the account lacks the key", () => {
    const src = buildAppFeaturesModule(
      [{ id: "existing", valueType: "boolean" }],
      {
        "pricing-phase-1-limits": "Record<string, unknown>",
        existing: "string", // must NOT override the account's type
      },
    );
    expect(src).toContain('"pricing-phase-1-limits": Record<string, unknown>;');
    expect(src).toContain("existing: boolean;");
    expect(src).not.toContain("existing: string;");
  });

  it("falls back to unknown for unrecognized valueTypes and rejects empty input", () => {
    const src = buildAppFeaturesModule([{ id: "weird", valueType: "secret" }]);
    expect(src).toContain("weird: unknown;");
    expect(() => buildAppFeaturesModule([])).toThrow(/empty AppFeatures/);
  });
});
