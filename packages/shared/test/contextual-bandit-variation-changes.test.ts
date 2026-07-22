import {
  assertAtLeastTwoVariations,
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

describe("reconcileVariationWeights — redistribute mode", () => {
  it("throws until the redistribution formula is implemented (P6)", () => {
    expect(() =>
      reconcileVariationWeights(
        [
          { variationId: "a", weight: 0.6 },
          { variationId: "b", weight: 0.4 },
        ],
        ["a", "b", "c"],
        "redistribute",
      ),
    ).toThrow(/not\s+implemented/i);
  });
});
