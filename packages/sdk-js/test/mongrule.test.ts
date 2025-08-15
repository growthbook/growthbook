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
});
