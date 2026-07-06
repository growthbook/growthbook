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

  describe("$ref", () => {
    // The SDK does not resolve `{ $ref: "path" }` markers. Server-side
    // invariant evaluation pre-resolves them (shared resolveRuleRefs) before
    // calling evalCondition, so here they must behave like any other unknown
    // operator: evaluate to false and never throw.
    it("treats $ref as an unknown operator and never throws", () => {
      const errorSpy = jest
        .spyOn(console, "error")
        .mockImplementation(() => undefined);
      try {
        expect(evalCondition({ a: 1 }, { a: { $ref: "missing" } }, {})).toBe(
          false,
        );
        expect(
          evalCondition({ a: "x", b: "x" }, { a: { $ref: "b" } }, {}),
        ).toBe(false);
      } finally {
        errorSpy.mockRestore();
      }
    });

    it("compares $ref-shaped operands as literal objects", () => {
      expect(
        evalCondition(
          { streams: 2, devices: 5 },
          { streams: { $lte: { $ref: "devices" } } },
          {},
        ),
      ).toBe(false);
      expect(
        evalCondition({ a: "x", b: "x" }, { a: { $eq: { $ref: "b" } } }, {}),
      ).toBe(false);
    });
  });
});
