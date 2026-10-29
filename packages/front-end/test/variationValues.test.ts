import { FeatureValueType } from "shared/types/feature";
import {
  getDuplicateRows,
  repairVariationValues,
  servedValues,
} from "@/components/Experiment/TabbedPage/variationValues";

const vals = (...values: (string | undefined)[]) =>
  values.map((value, i) => ({ variationId: `v${i}`, value }));
const ids = (n: number) => Array.from({ length: n }, (_, i) => `v${i}`);
// Duplicates within a single column.
const duplicates = (
  values: (string | undefined)[],
  valueType: FeatureValueType,
  sparse?: boolean,
  sparseBase?: string,
) =>
  getDuplicateRows(ids(values.length), [
    servedValues(vals(...values), valueType, sparse, sparseBase),
  ]);

describe("getDuplicateRows", () => {
  it("groups variations that share a value, and only those", () => {
    expect(duplicates(["true", "false", "true"], "boolean")).toEqual([
      ["v0", "v2"],
    ]);
    expect(duplicates(["a", "b", "c"], "string")).toEqual([]);
  });

  it("skips missing values", () => {
    expect(duplicates([undefined, undefined, "x"], "string")).toEqual([]);
  });

  it("compares numbers by value", () => {
    expect(duplicates(["1", "1.0", "2"], "number")).toEqual([["v0", "v1"]]);
  });

  it("compares JSON regardless of key order or formatting", () => {
    expect(
      duplicates(
        ['{"a":1,"b":[1,2]}', '{ "b": [1, 2], "a": 1 }', '{"b":[2,1],"a":1}'],
        "json",
      ),
    ).toEqual([["v0", "v1"]]);
  });

  it("compares sparse patches by the value they serve", () => {
    const base = '{"color":"gray","size":"md"}';
    // An empty patch serves the base, the same as spelling it out.
    expect(
      duplicates(
        ["{}", '{"color":"gray"}', '{"color":"blue"}'],
        "json",
        true,
        base,
      ),
    ).toEqual([["v0", "v1"]]);
  });

  it("matches only variations that agree in every column", () => {
    const column = (...values: string[]) =>
      servedValues(vals(...values), "boolean");
    // A 2x2 test pairs each value of one flag with both of the other.
    expect(
      getDuplicateRows(ids(4), [
        column("false", "false", "true", "true"),
        column("false", "true", "false", "true"),
      ]),
    ).toEqual([]);
    expect(
      getDuplicateRows(ids(3), [
        column("false", "false", "true"),
        column("true", "true", "true"),
      ]),
    ).toEqual([["v0", "v1"]]);
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
