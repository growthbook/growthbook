import {
  buildComboDimensionId,
  buildDateCutoffDimensionId,
  isCustomDimensionId,
  parseDimensionId,
} from "../src/experiments/dimension-ids";

describe("parseDimensionId", () => {
  it("parses existing dimension id forms unchanged", () => {
    expect(parseDimensionId("exp:country")).toEqual({
      kind: "experiment",
      column: "country",
      precomputed: false,
    });
    expect(parseDimensionId("precomputed:country")).toEqual({
      kind: "experiment",
      column: "country",
      precomputed: true,
    });
    expect(parseDimensionId("pre:date")).toEqual({ kind: "date" });
    expect(parseDimensionId("pre:activation")).toEqual({ kind: "activation" });
    expect(parseDimensionId("dim_abc123")).toEqual({
      kind: "user",
      id: "dim_abc123",
    });
  });

  it("rejects unknown pre: dimensions", () => {
    expect(parseDimensionId("pre:foo").kind).toBe("invalid");
  });

  it("parses date cutoff dimensions", () => {
    const parsed = parseDimensionId("cutoff:2026-01-15T00:12:00.000Z");
    expect(parsed).toEqual({
      kind: "datecutoff",
      cutoff: new Date("2026-01-15T00:12:00.000Z"),
    });
  });

  it("rejects invalid cutoff datetimes", () => {
    expect(parseDimensionId("cutoff:not-a-date").kind).toBe("invalid");
    expect(parseDimensionId("cutoff:").kind).toBe("invalid");
  });

  it("parses combo dimensions into constituent ids", () => {
    expect(parseDimensionId("combo:exp:country::dim_abc123")).toEqual({
      kind: "combo",
      constituentIds: ["exp:country", "dim_abc123"],
    });
    expect(parseDimensionId("combo:exp:country::exp:browser")).toEqual({
      kind: "combo",
      constituentIds: ["exp:country", "exp:browser"],
    });
    expect(parseDimensionId("combo:dim_a::dim_b")).toEqual({
      kind: "combo",
      constituentIds: ["dim_a", "dim_b"],
    });
  });

  it("rejects malformed combos", () => {
    // Wrong number of constituents
    expect(parseDimensionId("combo:exp:country").kind).toBe("invalid");
    expect(parseDimensionId("combo:dim_a::dim_b::dim_c").kind).toBe("invalid");
    // Empty constituent
    expect(parseDimensionId("combo:::dim_b").kind).toBe("invalid");
    expect(parseDimensionId("combo:dim_a::").kind).toBe("invalid");
    // Duplicates
    expect(parseDimensionId("combo:dim_a::dim_a").kind).toBe("invalid");
    // Nested prefixes
    expect(parseDimensionId("combo:pre:date::dim_b").kind).toBe("invalid");
    expect(parseDimensionId("combo:combo:dim_a::dim_b::dim_c").kind).toBe(
      "invalid",
    );
    expect(
      parseDimensionId("combo:cutoff:2026-01-15T00:00:00.000Z::dim_b").kind,
    ).toBe("invalid");
  });
});

describe("buildDateCutoffDimensionId", () => {
  it("round-trips through parseDimensionId with a canonical ISO string", () => {
    const cutoff = new Date("2026-01-15T00:12:00.000Z");
    const id = buildDateCutoffDimensionId(cutoff);
    expect(id).toBe("cutoff:2026-01-15T00:12:00.000Z");
    expect(parseDimensionId(id)).toEqual({ kind: "datecutoff", cutoff });
  });
});

describe("buildComboDimensionId", () => {
  it("round-trips through parseDimensionId", () => {
    const id = buildComboDimensionId(["exp:country", "dim_abc123"]);
    expect(id).toBe("combo:exp:country::dim_abc123");
    expect(parseDimensionId(id)).toEqual({
      kind: "combo",
      constituentIds: ["exp:country", "dim_abc123"],
    });
  });

  it("throws on invalid constituents", () => {
    expect(() => buildComboDimensionId(["exp:country"])).toThrow();
    expect(() => buildComboDimensionId(["dim_a", "dim_a"])).toThrow();
    expect(() => buildComboDimensionId(["pre:date", "dim_a"])).toThrow();
  });
});

describe("isCustomDimensionId", () => {
  it("identifies only the new configurable forms", () => {
    expect(isCustomDimensionId("cutoff:2026-01-15T00:12:00.000Z")).toBe(true);
    expect(isCustomDimensionId("combo:dim_a::dim_b")).toBe(true);
    expect(isCustomDimensionId("pre:date")).toBe(false);
    expect(isCustomDimensionId("exp:country")).toBe(false);
    expect(isCustomDimensionId("dim_abc123")).toBe(false);
  });
});

// The front-end routes date-cohort results with
// `dimension.substring(0, 8) === "pre:date"`; the new prefixes must never
// collide with that check
describe("pre:date prefix collision", () => {
  it("no custom dimension id starts with pre:date", () => {
    const ids = [
      buildDateCutoffDimensionId(new Date("2026-01-15T00:12:00.000Z")),
      buildComboDimensionId(["exp:country", "dim_abc123"]),
    ];
    ids.forEach((id) => {
      expect(id.substring(0, 8)).not.toBe("pre:date");
    });
  });
});
