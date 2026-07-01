import { evalCondition } from "../src/mongrule";

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

  describe("$ref (field-to-field)", () => {
    it("compares a field to another field via $ref", () => {
      // streams <= devices
      expect(
        evalCondition(
          { streams: 2, devices: 5 },
          { streams: { $lte: { $ref: "devices" } } },
          {},
        ),
      ).toBe(true);
      expect(
        evalCondition(
          { streams: 6, devices: 5 },
          { streams: { $lte: { $ref: "devices" } } },
          {},
        ),
      ).toBe(false);
    });

    it("supports $eq / $ne between two fields", () => {
      expect(
        evalCondition({ a: "x", b: "x" }, { a: { $eq: { $ref: "b" } } }, {}),
      ).toBe(true);
      expect(
        evalCondition({ a: "x", b: "y" }, { a: { $ne: { $ref: "b" } } }, {}),
      ).toBe(true);
    });

    it("resolves a nested dot-path ref", () => {
      expect(
        evalCondition(
          { a: 3, limits: { max: 5 } },
          { a: { $lte: { $ref: "limits.max" } } },
          {},
        ),
      ).toBe(true);
    });

    it("resolves a missing ref field to null", () => {
      expect(
        evalCondition({ a: 1 }, { a: { $eq: { $ref: "missing" } } }, {}),
      ).toBe(false);
    });

    it("works inside $or (implication: streams<=devices OR unlimited)", () => {
      const cond = {
        $or: [{ unlimited: true }, { streams: { $lte: { $ref: "devices" } } }],
      };
      expect(
        evalCondition({ unlimited: false, streams: 9, devices: 5 }, cond, {}),
      ).toBe(false);
      expect(
        evalCondition({ unlimited: true, streams: 9, devices: 5 }, cond, {}),
      ).toBe(true);
    });

    it("leaves ordinary literal conditions unchanged", () => {
      expect(evalCondition({ a: 3 }, { a: { $lte: 5 } }, {})).toBe(true);
    });
  });
});
