import {
  assertAtLeastTwoVariations,
  defaultAddedVariationValue,
  diffVariations,
  getRemovedVariationsInUse,
  MIN_CONTEXTUAL_BANDIT_VARIATIONS,
  reconcileVariationWeights,
} from "../src/experiments/contextual-bandit-variation-changes";

const ids = (list: string[]) => list.map((id) => ({ id }));

const sum = (pairs: { weight: number }[]) =>
  pairs.reduce((s, p) => s + p.weight, 0);

describe("diffVariations", () => {
  it("detects added, removed, and kept variations by id", () => {
    const diff = diffVariations(ids(["a", "b", "c"]), ids(["b", "c", "d"]));
    expect(diff.addedIds).toEqual(["d"]);
    expect(diff.removedIds).toEqual(["a"]);
    expect(diff.keptIds).toEqual(["b", "c"]);
  });

  it("returns empty diffs when the set is unchanged", () => {
    const diff = diffVariations(ids(["a", "b"]), ids(["a", "b"]));
    expect(diff.addedIds).toEqual([]);
    expect(diff.removedIds).toEqual([]);
    expect(diff.keptIds).toEqual(["a", "b"]);
  });

  it("orders added/kept by the new set and removed by the previous set", () => {
    const diff = diffVariations(ids(["x", "a", "b"]), ids(["b", "c", "a"]));
    expect(diff.keptIds).toEqual(["b", "a"]);
    expect(diff.addedIds).toEqual(["c"]);
    expect(diff.removedIds).toEqual(["x"]);
  });
});

describe("assertAtLeastTwoVariations", () => {
  it("throws when fewer than the minimum number of variations", () => {
    expect(() => assertAtLeastTwoVariations(ids(["a"]))).toThrow();
    expect(() => assertAtLeastTwoVariations([])).toThrow();
  });

  it("passes with two or more variations", () => {
    expect(() => assertAtLeastTwoVariations(ids(["a", "b"]))).not.toThrow();
    expect(() =>
      assertAtLeastTwoVariations(ids(["a", "b", "c"])),
    ).not.toThrow();
  });

  it("uses the shared minimum constant", () => {
    expect(MIN_CONTEXTUAL_BANDIT_VARIATIONS).toBe(2);
  });
});

describe("getRemovedVariationsInUse", () => {
  it("returns removed ids that are still referenced", () => {
    expect(getRemovedVariationsInUse(["a", "b"], ["b", "c"])).toEqual(["b"]);
  });

  it("returns empty when no removed id is referenced", () => {
    expect(getRemovedVariationsInUse(["a"], ["b", "c"])).toEqual([]);
  });

  it("accepts any iterable of referenced ids (e.g. a Set)", () => {
    expect(getRemovedVariationsInUse(["a", "b"], new Set(["a"]))).toEqual([
      "a",
    ]);
  });
});

describe("reconcileVariationWeights — uniform mode", () => {
  it("evenly splits across the new set when a variation is added", () => {
    const result = reconcileVariationWeights(
      [
        { variationId: "a", weight: 0.5 },
        { variationId: "b", weight: 0.5 },
      ],
      ["a", "b", "c"],
      "uniform",
    );
    expect(result.map((p) => p.variationId)).toEqual(["a", "b", "c"]);
    expect(sum(result)).toBeCloseTo(1, 6);
    result.forEach((p) => expect(p.weight).toBeCloseTo(1 / 3, 3));
  });

  it("evenly splits across the new set when a variation is removed", () => {
    const result = reconcileVariationWeights(
      [
        { variationId: "a", weight: 0.2 },
        { variationId: "b", weight: 0.3 },
        { variationId: "c", weight: 0.5 },
      ],
      ["a", "c"],
      "uniform",
    );
    expect(result.map((p) => p.variationId)).toEqual(["a", "c"]);
    expect(sum(result)).toBeCloseTo(1, 6);
    result.forEach((p) => expect(p.weight).toBeCloseTo(0.5, 6));
  });

  it("preserves the new-set order in the output", () => {
    const result = reconcileVariationWeights([], ["c", "a", "b"], "uniform");
    expect(result.map((p) => p.variationId)).toEqual(["c", "a", "b"]);
  });
});

describe("defaultAddedVariationValue", () => {
  it("prefers a caller-supplied value", () => {
    expect(defaultAddedVariationValue("mine", "control", "def")).toBe("mine");
  });
  it("falls back to the control value when none supplied", () => {
    expect(defaultAddedVariationValue(undefined, "control", "def")).toBe(
      "control",
    );
  });
  it("falls back to the feature default when there is no control value", () => {
    expect(defaultAddedVariationValue(undefined, undefined, "def")).toBe("def");
  });
  it("treats an empty-string supplied value as an intentional value", () => {
    expect(defaultAddedVariationValue("", "control", "def")).toBe("");
  });
});

describe("reconcileVariationWeights — redistribute mode (Luke A + B)", () => {
  const w = (pairs: Record<string, number>) =>
    Object.entries(pairs).map(([variationId, weight]) => ({
      variationId,
      weight,
    }));
  const asMap = (pairs: { variationId: string; weight: number }[]) =>
    Object.fromEntries(pairs.map((p) => [p.variationId, p.weight]));

  it("Algorithm A — drop: redistributes dropped mass proportionally over survivors", () => {
    // drop b (S=0.3); survivors a,c mass 0.7 → a=0.2/0.7, c=0.5/0.7.
    const res = reconcileVariationWeights(
      w({ a: 0.2, b: 0.3, c: 0.5 }),
      ["a", "c"],
      "redistribute",
    );
    expect(res.map((p) => p.variationId)).toEqual(["a", "c"]);
    expect(sum(res)).toBeCloseTo(1, 6);
    const m = asMap(res);
    expect(m.a).toBeCloseTo(0.2 / 0.7, 6);
    expect(m.c).toBeCloseTo(0.5 / 0.7, 6);
  });

  it("Algorithm B — add: survivors scaled by K/(K+N), each new arm 1/(K+N)", () => {
    // K=2, N=1 → survivors ×2/3, new arm 1/3.
    const res = reconcileVariationWeights(
      w({ a: 0.6, b: 0.4 }),
      ["a", "b", "c"],
      "redistribute",
    );
    const m = asMap(res);
    expect(m.a).toBeCloseTo((2 / 3) * 0.6, 6);
    expect(m.b).toBeCloseTo((2 / 3) * 0.4, 6);
    expect(m.c).toBeCloseTo(1 / 3, 6);
    expect(sum(res)).toBeCloseTo(1, 6);
  });

  it("combined add + remove (10 arms → drop 4, add 2 = 8): A then B, sums to 1", () => {
    // Survivors s0..s5 (6) with the given weights (sum 0.6); dropped d0..d3 (sum 0.4); add n0,n1.
    const current = w({
      s0: 0.05,
      s1: 0.1,
      s2: 0.15,
      s3: 0.05,
      s4: 0.1,
      s5: 0.15,
      d0: 0.1,
      d1: 0.1,
      d2: 0.1,
      d3: 0.1,
    });
    const res = reconcileVariationWeights(
      current,
      ["s0", "s1", "s2", "s3", "s4", "s5", "n0", "n1"],
      "redistribute",
    );
    expect(res.map((p) => p.variationId)).toEqual([
      "s0",
      "s1",
      "s2",
      "s3",
      "s4",
      "s5",
      "n0",
      "n1",
    ]);
    expect(sum(res)).toBeCloseTo(1, 6);
    const m = asMap(res);
    // survivor normalized by mass 0.6, then ×(6/8): e.g. s2 = (0.15/0.6)*0.75.
    expect(m.s2).toBeCloseTo((0.15 / 0.6) * (6 / 8), 6);
    expect(m.s0).toBeCloseTo((0.05 / 0.6) * (6 / 8), 6);
    // each added arm = 1/8.
    expect(m.n0).toBeCloseTo(1 / 8, 6);
    expect(m.n1).toBeCloseTo(1 / 8, 6);
    // survivor proportions preserved among themselves.
    expect(m.s2 / m.s0).toBeCloseTo(0.15 / 0.05, 6);
  });

  it("pure add keeps relative survivor proportions", () => {
    const res = reconcileVariationWeights(
      w({ a: 0.7, b: 0.3 }),
      ["a", "b", "c", "d"],
      "redistribute",
    );
    const m = asMap(res);
    expect(m.a / m.b).toBeCloseTo(0.7 / 0.3, 6);
    expect(m.c).toBeCloseTo(1 / 4, 6);
    expect(m.d).toBeCloseTo(1 / 4, 6);
    expect(sum(res)).toBeCloseTo(1, 6);
  });

  it("full replacement (no survivors) → uniform over the new arms", () => {
    const res = reconcileVariationWeights(
      w({ a: 0.5, b: 0.5 }),
      ["c", "d"],
      "redistribute",
    );
    expect(asMap(res)).toEqual({ c: 0.5, d: 0.5 });
  });

  it("zero-mass survivors fall back to an even split among survivors", () => {
    // Drop c (which holds all the mass); a,b had 0 → even split.
    const res = reconcileVariationWeights(
      w({ a: 0, b: 0, c: 1 }),
      ["a", "b"],
      "redistribute",
    );
    expect(sum(res)).toBeCloseTo(1, 6);
    const m = asMap(res);
    expect(m.a).toBeCloseTo(0.5, 6);
    expect(m.b).toBeCloseTo(0.5, 6);
  });

  it("emits weights in newVariationIds order", () => {
    const res = reconcileVariationWeights(
      w({ a: 0.6, b: 0.4 }),
      ["c", "b", "a"],
      "redistribute",
    );
    expect(res.map((p) => p.variationId)).toEqual(["c", "b", "a"]);
  });
});
