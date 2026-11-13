import { canonicalValue, sameCanonicalValue } from "../src/util/sortObjectKeys";

describe("sameCanonicalValue", () => {
  it.each([
    ["key order", { a: 1, b: { c: 2, d: 3 } }, { b: { d: 3, c: 2 }, a: 1 }],
    [
      "empty fields as absent",
      { id: "v0", dom: [], screenshots: [], condition: {}, description: "" },
      { id: "v0", note: null, extra: undefined },
    ],
    ["an empty value as none", "", null],
    ["a date as its ISO string", new Date(0), "1970-01-01T00:00:00.000Z"],
  ])("ignores %s", (_, a, b) => {
    expect(sameCanonicalValue(a, b)).toBe(true);
  });

  it.each([
    ["array order", [0.4, 0.6], [0.6, 0.4]],
    ["an empty array element", [{ id: "v0" }, {}], [{ id: "v0" }]],
    ["a value beside empty fields", { a: 1, b: [] }, { a: 2 }],
    ["zero and false as values", { a: 0, b: false }, {}],
  ])("tells %s apart", (_, a, b) => {
    expect(sameCanonicalValue(a, b)).toBe(false);
  });

  it("shows a value with its keys sorted and empty fields dropped", () => {
    expect(
      JSON.stringify(
        canonicalValue({ key: "1", dom: [], id: "v1", name: "B" }),
      ),
    ).toBe('{"id":"v1","key":"1","name":"B"}');
  });
});
