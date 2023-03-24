import { evalCondition } from "../src/mongrule";

describe("Mongrule", () => {
  describe("Null", () => {
    it("Returns true when the value is null or not present", () => {
      expect(
        evalCondition(
          { userId: null },
          {
            userId: null,
          }
        )
      ).toBe(true);

      expect(
        evalCondition(
          {},
          {
            userId: null,
          }
        )
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
          }
        )
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
          }
        )
      ).toBe(false);

      expect(
        evalCondition(
          {
            userId: "",
          },
          {
            userId: null,
          }
        )
      ).toBe(false);

      expect(
        evalCondition(
          { userId: undefined },
          {
            userId: null,
          }
        )
      ).toBe(false);
    });
  });
});
