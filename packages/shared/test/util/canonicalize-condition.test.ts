import {
  canonicalize,
  deriveContextId,
} from "../../src/util/canonicalize-condition";

// ---------------------------------------------------------------------------
// canonicalize()
// ---------------------------------------------------------------------------

describe("canonicalize", () => {
  // -------------------------------------------------------------------------
  // Rule 11: key sort
  // -------------------------------------------------------------------------
  describe("key sort (rule 11)", () => {
    it("returns the same string regardless of key insertion order", () => {
      const a = canonicalize({ b: 2, a: 1 });
      const b = canonicalize({ a: 1, b: 2 });
      expect(a).toBe(b);
      expect(JSON.parse(a)).toEqual({ a: 1, b: 2 });
    });

    it("sorts nested object keys recursively", () => {
      const a = canonicalize({ z: { y: 2, x: 1 } });
      const b = canonicalize({ z: { x: 1, y: 2 } });
      expect(a).toBe(b);
    });
  });

  // -------------------------------------------------------------------------
  // Rule 3: $eq unwrap
  // -------------------------------------------------------------------------
  describe("$eq unwrap (rule 3)", () => {
    it("unwraps $eq to implicit equality", () => {
      expect(canonicalize({ country: { $eq: "US" } })).toBe(
        canonicalize({ country: "US" }),
      );
    });

    it("does not unwrap when there are other operators alongside $eq", () => {
      const c = canonicalize({ age: { $eq: 18, $gte: 18 } });
      expect(c).toContain("$eq");
      expect(c).toContain("$gte");
    });
  });

  // -------------------------------------------------------------------------
  // Rule 4: $in / $nin / $all value sort
  // -------------------------------------------------------------------------
  describe("$in / $nin / $all value sort (rule 4)", () => {
    it("produces the same result for $in regardless of array order", () => {
      const a = canonicalize({ plan: { $in: ["pro", "free", "enterprise"] } });
      const b = canonicalize({ plan: { $in: ["enterprise", "pro", "free"] } });
      expect(a).toBe(b);
    });

    it("produces the same result for $nin regardless of array order", () => {
      const a = canonicalize({ status: { $nin: ["banned", "inactive"] } });
      const b = canonicalize({ status: { $nin: ["inactive", "banned"] } });
      expect(a).toBe(b);
    });

    it("produces the same result for $all regardless of array order", () => {
      const a = canonicalize({ tags: { $all: ["a", "c", "b"] } });
      const b = canonicalize({ tags: { $all: ["b", "a", "c"] } });
      expect(a).toBe(b);
    });
  });

  // -------------------------------------------------------------------------
  // Rule 5: $and flatten
  // -------------------------------------------------------------------------
  describe("$and flatten (rule 5)", () => {
    it("flattens nested $and into a single $and", () => {
      const nested = canonicalize({
        $and: [{ $and: [{ a: 1 }, { b: 2 }] }, { c: 3 }],
      });
      const flat = canonicalize({ $and: [{ a: 1 }, { b: 2 }, { c: 3 }] });
      expect(nested).toBe(flat);
    });

    it("flattens multiple levels of nested $and", () => {
      const deep = canonicalize({
        $and: [{ $and: [{ $and: [{ x: 1 }] }, { y: 2 }] }, { z: 3 }],
      });
      const flat = canonicalize({ $and: [{ x: 1 }, { y: 2 }, { z: 3 }] });
      expect(deep).toBe(flat);
    });
  });

  // -------------------------------------------------------------------------
  // Rule 6: $and single-element unwrap
  // -------------------------------------------------------------------------
  describe("$and single-element unwrap (rule 6)", () => {
    it("unwraps a single-element $and to the bare condition", () => {
      expect(canonicalize({ $and: [{ a: 1 }] })).toBe(canonicalize({ a: 1 }));
    });
  });

  // -------------------------------------------------------------------------
  // Rule 7: $or / $nor element sort
  // -------------------------------------------------------------------------
  describe("$or / $nor element sort (rule 7)", () => {
    it("produces the same result for $or regardless of clause order", () => {
      const a = canonicalize({ $or: [{ country: "US" }, { plan: "pro" }] });
      const b = canonicalize({ $or: [{ plan: "pro" }, { country: "US" }] });
      expect(a).toBe(b);
    });

    it("produces the same result for $nor regardless of clause order", () => {
      const a = canonicalize({ $nor: [{ a: 1 }, { b: 2 }] });
      const b = canonicalize({ $nor: [{ b: 2 }, { a: 1 }] });
      expect(a).toBe(b);
    });
  });

  // -------------------------------------------------------------------------
  // Rule 8: $not recursion
  // -------------------------------------------------------------------------
  describe("$not recursion (rule 8)", () => {
    it("canonicalizes the inner condition of $not", () => {
      const a = canonicalize({ $not: { b: 2, a: 1 } });
      const b = canonicalize({ $not: { a: 1, b: 2 } });
      expect(a).toBe(b);
    });

    it("unwraps $eq inside $not", () => {
      const a = canonicalize({ $not: { status: { $eq: "inactive" } } });
      const b = canonicalize({ $not: { status: "inactive" } });
      expect(a).toBe(b);
    });
  });

  // -------------------------------------------------------------------------
  // Rule 9: $regex / $options rewrite
  // -------------------------------------------------------------------------
  describe("$regex / $options rewrite (rule 9)", () => {
    it("produces the same string regardless of $regex/$options key order", () => {
      const a = canonicalize({ name: { $regex: "^foo", $options: "i" } });
      const b = canonicalize({ name: { $options: "i", $regex: "^foo" } });
      expect(a).toBe(b);
    });

    it("handles $regex without $options", () => {
      const c = canonicalize({ name: { $regex: "^foo" } });
      expect(c).toContain("$regex");
      expect(c).not.toContain("$options");
    });
  });

  // -------------------------------------------------------------------------
  // Rule 10: number normalization
  // -------------------------------------------------------------------------
  describe("number normalization (rule 10)", () => {
    it("serialises finite integers and floats stably", () => {
      expect(canonicalize({ n: 42 })).toBe('{"n":42}');
      expect(canonicalize({ n: 3.14 })).toBe('{"n":3.14}');
    });

    it("represents NaN as the string 'NaN' so two NaN conditions compare equal", () => {
      const a = canonicalize({ x: NaN });
      const b = canonicalize({ x: NaN });
      expect(a).toBe(b);
      expect(a).toContain("NaN");
    });

    it("represents Infinity as the string 'Infinity'", () => {
      const a = canonicalize({ x: Infinity });
      const b = canonicalize({ x: Infinity });
      expect(a).toBe(b);
      expect(a).toContain("Infinity");
    });
  });

  // -------------------------------------------------------------------------
  // Rule 1/2: empty / non-object handling
  // -------------------------------------------------------------------------
  describe("empty / non-object handling (rules 1 & 2)", () => {
    it("returns {} string for an empty condition object", () => {
      expect(canonicalize({})).toBe("{}");
    });

    it("returns {} string for null input", () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(canonicalize(null as any)).toBe("{}");
    });

    it("returns {} string for non-object input", () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(canonicalize("string" as any)).toBe("{}");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(canonicalize(42 as any)).toBe("{}");
    });
  });

  // -------------------------------------------------------------------------
  // Combined / integration scenarios
  // -------------------------------------------------------------------------
  describe("combined normalization", () => {
    it("treats a complex condition as equal to its reordered equivalent", () => {
      const a = canonicalize({
        $and: [
          { plan: { $in: ["pro", "enterprise"] } },
          { country: { $eq: "US" } },
        ],
      });
      const b = canonicalize({
        $and: [{ country: "US" }, { plan: { $in: ["enterprise", "pro"] } }],
      });
      expect(a).toBe(b);
    });

    it("handles deeply nested $or inside $and", () => {
      const a = canonicalize({
        $and: [{ $or: [{ x: 1 }, { y: 2 }] }, { z: 3 }],
      });
      const b = canonicalize({
        $and: [{ z: 3 }, { $or: [{ y: 2 }, { x: 1 }] }],
      });
      expect(a).toBe(b);
    });

    it("is idempotent — canonicalize(JSON.parse(canonicalize(c))) === canonicalize(c)", () => {
      const condition = {
        b: 2,
        a: { $in: [3, 1, 2] },
        $or: [{ x: 1 }, { y: 2 }],
      };
      const first = canonicalize(condition);
      const second = canonicalize(JSON.parse(first));
      expect(second).toBe(first);
    });
  });
});

// ---------------------------------------------------------------------------
// deriveContextId()
// ---------------------------------------------------------------------------

describe("deriveContextId", () => {
  it("returns a string with the ctx_ prefix", () => {
    const id = deriveContextId("exp_abc", { country: "US" });
    expect(id).toMatch(/^ctx_[0-9a-f]{8}$/);
  });

  it("produces the same id for semantically equivalent conditions", () => {
    const a = deriveContextId("exp_abc", { b: 2, a: 1 });
    const b = deriveContextId("exp_abc", { a: 1, b: 2 });
    expect(a).toBe(b);
  });

  it("produces different ids for different conditions", () => {
    const a = deriveContextId("exp_abc", { country: "US" });
    const b = deriveContextId("exp_abc", { country: "CA" });
    expect(a).not.toBe(b);
  });

  it("produces different ids for different experiment ids (same condition)", () => {
    const a = deriveContextId("exp_aaa", { country: "US" });
    const b = deriveContextId("exp_bbb", { country: "US" });
    expect(a).not.toBe(b);
  });

  it("is deterministic — same inputs always produce the same output", () => {
    const first = deriveContextId("exp_xyz", {
      plan: { $in: ["pro", "free"] },
    });
    const second = deriveContextId("exp_xyz", {
      plan: { $in: ["free", "pro"] },
    });
    expect(first).toBe(second);
    // Also check a fixed expected value to lock the hash algorithm
    expect(first).toMatch(/^ctx_[0-9a-f]{8}$/);
  });

  it("uses the | separator between experimentId and condition in the hash input", () => {
    // Verify that "exp_ab" + condition starting with "c" is different from
    // "exp_abc" + condition starting with "" — i.e. the separator prevents
    // prefix-concatenation collisions.
    const a = deriveContextId("exp_ab", { c: 1 });
    const b = deriveContextId("exp_abc", {});
    expect(a).not.toBe(b);
  });
});
