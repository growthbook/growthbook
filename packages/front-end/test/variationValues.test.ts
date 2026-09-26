import {
  getDuplicateVariationIds,
  repairVariationValues,
} from "@/components/Experiment/TabbedPage/variationValues";

const vals = (...values: (string | undefined)[]) =>
  values.map((value, i) => ({ variationId: `v${i}`, value }));

describe("getDuplicateVariationIds", () => {
  it("flags every variation that shares a value, and only those", () => {
    expect(
      getDuplicateVariationIds(vals("true", "false", "true"), "boolean"),
    ).toEqual(new Set(["v0", "v2"]));
    expect(getDuplicateVariationIds(vals("a", "b", "c"), "string")).toEqual(
      new Set(),
    );
  });

  it("skips missing values", () => {
    expect(
      getDuplicateVariationIds(vals(undefined, undefined, "x"), "string"),
    ).toEqual(new Set());
  });

  it("compares numbers by value", () => {
    expect(getDuplicateVariationIds(vals("1", "1.0", "2"), "number")).toEqual(
      new Set(["v0", "v1"]),
    );
  });

  it("compares JSON regardless of key order or formatting", () => {
    expect(
      getDuplicateVariationIds(
        vals(
          '{"a":1,"b":[1,2]}',
          '{ "b": [1, 2], "a": 1 }',
          '{"b":[2,1],"a":1}',
        ),
        "json",
      ),
    ).toEqual(new Set(["v0", "v1"]));
  });

  it("compares sparse patches by the value they serve", () => {
    const base = '{"color":"gray","size":"md"}';
    // An empty patch serves the base, the same as spelling it out.
    expect(
      getDuplicateVariationIds(
        vals("{}", '{"color":"gray"}', '{"color":"blue"}'),
        "json",
        true,
        base,
      ),
    ).toEqual(new Set(["v0", "v1"]));
  });
});

describe("repairVariationValues", () => {
  it("returns every stored value and only the ones it had to repair", () => {
    const values: Record<string, string> = { a: '{"x":1}', b: '{"x":1,}' };
    const { checked, repaired } = repairVariationValues(
      { valueType: "json" },
      [
        { id: "a", index: 0 },
        { id: "b", index: 1 },
      ],
      (id) => values[id],
    );
    expect(Object.keys(repaired)).toEqual(["b"]);
    expect(JSON.parse(repaired.b)).toEqual({ x: 1 });
    expect(checked.map((c) => c.variationId)).toEqual(["a", "b"]);
    expect(checked[1].value).toBe(repaired.b);
  });
});
