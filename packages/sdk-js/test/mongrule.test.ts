import { evalCondition } from "../src/mongrule";
import { ConditionTypeMismatch } from "../src/types/mongrule";
import { SavedGroupsPayload } from "../src/types/growthbook";

describe("Mongrule", () => {
  describe("Null", () => {
    it("Returns true when the value is null or not present", () => {
      expect(
        evalCondition(
          { userId: null },
          {
            userId: null,
          },
          {},
        ),
      ).toBe(true);

      expect(
        evalCondition(
          {},
          {
            userId: null,
          },
          {},
        ),
      ).toBe(true);
    });

    it("Returns false when the value is present", () => {
      expect(
        evalCondition(
          {
            userId: "123",
          },
          {
            userId: null,
          },
          {},
        ),
      ).toBe(false);
    });

    it("Returns false when the value is present but falsy", () => {
      expect(
        evalCondition(
          {
            userId: 0,
          },
          {
            userId: null,
          },
          {},
        ),
      ).toBe(false);

      expect(
        evalCondition(
          {
            userId: "",
          },
          {
            userId: null,
          },
          {},
        ),
      ).toBe(false);

      expect(
        evalCondition(
          { userId: undefined },
          {
            userId: null,
          },
          {},
        ),
      ).toBe(false);
    });

    it("Counts both undefined and null attributes as not existing, but not other falsy values", () => {
      expect(
        evalCondition(
          {
            email: undefined,
          },
          {
            email: { $exists: true },
          },
          {},
        ),
      ).toBe(false);

      expect(
        evalCondition(
          {
            email: undefined,
          },
          {
            email: { $exists: false },
          },
          {},
        ),
      ).toBe(true);

      expect(
        evalCondition(
          {
            email: null,
          },
          {
            email: { $exists: true },
          },
          {},
        ),
      ).toBe(false);

      expect(
        evalCondition(
          {
            email: null,
          },
          {
            email: { $exists: false },
          },
          {},
        ),
      ).toBe(true);

      expect(
        evalCondition(
          {
            email: "",
          },
          {
            email: { $exists: true },
          },
          {},
        ),
      ).toBe(true);

      expect(
        evalCondition(
          {
            email: "",
          },
          {
            email: { $exists: false },
          },
          {},
        ),
      ).toBe(false);

      expect(
        evalCondition(
          {
            email: 0,
          },
          {
            email: { $exists: true },
          },
          {},
        ),
      ).toBe(true);

      expect(
        evalCondition(
          {
            email: 0,
          },
          {
            email: { $exists: false },
          },
          {},
        ),
      ).toBe(false);
    });
  });

  describe("$elemMatch with falsy array elements", () => {
    it("matches falsy elements (0, false, empty string) in an array", () => {
      expect(
        evalCondition({ nums: [0] }, { nums: { $elemMatch: { $eq: 0 } } }, {}),
      ).toBe(true);
      expect(
        evalCondition(
          { flags: [false] },
          { flags: { $elemMatch: { $eq: false } } },
          {},
        ),
      ).toBe(true);
      expect(
        evalCondition(
          { tags: [""] },
          { tags: { $elemMatch: { $eq: "" } } },
          {},
        ),
      ).toBe(true);
    });
    it("still returns false when no array element matches", () => {
      expect(
        evalCondition(
          { nums: [1, 2] },
          { nums: { $elemMatch: { $eq: 0 } } },
          {},
        ),
      ).toBe(false);
    });
  });

  describe("Type mismatch callback", () => {
    const collect = (
      attributes: Record<string, unknown>,
      condition: Parameters<typeof evalCondition>[1],
      savedGroups: SavedGroupsPayload = {},
    ) => {
      const mismatches: ConditionTypeMismatch[] = [];
      const result = evalCondition(attributes, condition, {
        savedGroups,
        onTypeMismatch: (m) => mismatches.push(m),
      });
      return { result, mismatches };
    };

    it("reports implicit equality across types", () => {
      expect(collect({ x: "5" }, { x: 5 })).toEqual({
        result: false,
        mismatches: [{ path: "x", operator: "$eq", expected: 5, actual: "5" }],
      });
    });

    it("reports a mismatch that makes a negation pass", () => {
      expect(collect({ x: "5" }, { x: { $ne: 5 } })).toEqual({
        result: true,
        mismatches: [{ path: "x", operator: "$ne", expected: 5, actual: "5" }],
      });
    });

    it("reports a missing attribute in a comparison", () => {
      expect(collect({}, { age: { $lt: 10 } })).toEqual({
        result: false,
        mismatches: [
          { path: "age", operator: "$lt", expected: 10, actual: null },
        ],
      });
    });

    it("reports a mismatch inside $or even when another branch passes", () => {
      const { result, mismatches } = collect(
        { x: "5", y: 1 },
        { $or: [{ x: 5 }, { y: 1 }] },
      );
      expect(result).toBe(true);
      expect(mismatches).toEqual([
        { path: "x", operator: "$eq", expected: 5, actual: "5" },
      ]);
    });

    it("reports regex and version operators on non-strings", () => {
      expect(collect({ x: 5 }, { x: { $regex: "5" } }).mismatches).toEqual([
        { path: "x", operator: "$regex", expected: "5", actual: 5 },
      ]);
      expect(collect({ v: 2 }, { v: { $vgt: "1.0.0" } }).mismatches).toEqual([
        { path: "v", operator: "$vgt", expected: "1.0.0", actual: 2 },
      ]);
    });

    it("reports $in only when no listed value has the attribute's type", () => {
      expect(collect({ x: "5" }, { x: { $in: [5] } }).mismatches).toEqual([
        { path: "x", operator: "$in", expected: [5], actual: "5" },
      ]);
      expect(collect({ x: "6" }, { x: { $in: ["5"] } }).mismatches).toEqual([]);
    });

    it("reports saved group mismatches", () => {
      expect(
        collect({ id: 2 }, { id: { $inGroup: "g" } }, { g: ["1", "2"] })
          .mismatches,
      ).toEqual([
        { path: "id", operator: "$inGroup", expected: ["1", "2"], actual: 2 },
      ]);
    });

    it("prefixes nested paths", () => {
      expect(
        collect({ items: [{ n: "5" }] }, { items: { $elemMatch: { n: 5 } } })
          .mismatches,
      ).toEqual([
        { path: "items.n", operator: "$eq", expected: 5, actual: "5" },
      ]);
    });

    it("reports array operators on non-array attributes", () => {
      expect(
        collect({ tags: "beta" }, { tags: { $elemMatch: { $eq: "beta" } } })
          .mismatches,
      ).toEqual([
        {
          path: "tags",
          operator: "$elemMatch",
          expected: { $eq: "beta" },
          actual: "beta",
        },
      ]);
      expect(
        collect({ tags: "abc" }, { tags: { $size: 3 } }).mismatches,
      ).toEqual([
        { path: "tags", operator: "$size", expected: 3, actual: "abc" },
      ]);
      expect(
        collect({ tags: "a" }, { tags: { $alli: ["a"] } }).mismatches,
      ).toEqual([
        { path: "tags", operator: "$alli", expected: ["a"], actual: "a" },
      ]);
    });

    it("reports whole array and object comparisons across types", () => {
      expect(collect({ tags: "a" }, { tags: ["a"] }).mismatches).toEqual([
        { path: "tags", operator: "$eq", expected: ["a"], actual: "a" },
      ]);
      expect(collect({ meta: ["a"] }, { meta: { a: 1 } }).mismatches).toEqual([
        { path: "meta", operator: "$eq", expected: { a: 1 }, actual: ["a"] },
      ]);
    });

    it("reports nothing for empty lists", () => {
      expect(collect({ id: "1" }, { id: { $in: [] } }).mismatches).toEqual([]);
      expect(
        collect({ id: "1" }, { id: { $inGroup: "unknown" } }).mismatches,
      ).toEqual([]);
    });

    it("reports nothing when types match", () => {
      expect(
        collect({ x: 5, s: "a" }, { x: { $gt: 1 }, s: { $in: ["b"] } })
          .mismatches,
      ).toEqual([]);
    });
  });
});
