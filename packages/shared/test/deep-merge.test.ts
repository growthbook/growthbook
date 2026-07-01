import { deepMergePatch } from "../src/util/deep-merge";

describe("deepMergePatch", () => {
  it("merges plain objects recursively, leaving unrestated leaves intact", () => {
    expect(
      deepMergePatch(
        { retry: { timeouts: { connect: 1000, read: 5000, write: 3000 } } },
        { retry: { timeouts: { read: 8000 } } },
      ),
    ).toEqual({
      retry: { timeouts: { connect: 1000, read: 8000, write: 3000 } },
    });
  });

  it("replaces arrays wholesale (atomic, no element merge)", () => {
    expect(deepMergePatch({ a: [1, 2, 3] }, { a: [9] })).toEqual({ a: [9] });
  });

  it("treats null as a value, not a deletion", () => {
    expect(deepMergePatch({ a: 1, b: 2 }, { a: null })).toEqual({
      a: null,
      b: 2,
    });
  });

  it("replaces when a scalar patches an object (and vice versa)", () => {
    expect(deepMergePatch({ a: { x: 1 } }, { a: "flat" })).toEqual({
      a: "flat",
    });
    expect(deepMergePatch({ a: "flat" }, { a: { x: 1 } })).toEqual({
      a: { x: 1 },
    });
  });

  it("applies a $extends chunk wholesale on either side (never merges into it)", () => {
    // patch is a chunk → replace
    expect(deepMergePatch({ a: 1 }, { $extends: ["@const:x"], b: 2 })).toEqual({
      $extends: ["@const:x"],
      b: 2,
    });
    // base is a chunk → replace
    expect(deepMergePatch({ $extends: ["@const:x"], a: 1 }, { b: 2 })).toEqual({
      b: 2,
    });
  });
});
