import { GrowthBook } from "../src";
import { Context } from "../src/types/growthbook";

Object.defineProperty(window, "location", {
  value: {
    ...window.location,
  },
  writable: true,
});

describe("preview links", () => {
  beforeEach(() => {
    window.location.href = "http://app.customer.com";
  });

  describe("when experiment is inactive and query param override is set", () => {
    it("should consider the client in the experiment", () => {
      window.location.href = "http://app.customer.com?exp-01=1";
      const context: Context = { user: { id: "1" } };
      const growthbook = new GrowthBook(context);
      expect(
        growthbook.run({
          key: "exp-01",
          active: false,
          variations: [0, 1],
          urlPatterns: [
            {
              include: true,
              pattern: "http://app.customer.com",
              type: "simple",
            },
          ],
        }).inExperiment
      ).toEqual(true);

      window.location.href = "http://app.customer.com";
      expect(
        growthbook.run({
          key: "exp-01",
          active: false,
          variations: [0, 1],
          urlPatterns: [
            {
              include: true,
              pattern: "http://app.customer.com",
              type: "simple",
            },
          ],
        }).inExperiment
      ).toEqual(false);
    });

    it("should match the variation index with the index supplied via query param", () => {
      window.location.href = "http://app.customer.com?exp-01=1";
      const context: Context = { user: { id: "1" } };
      const growthbook = new GrowthBook(context);
      expect(
        growthbook.run({
          key: "exp-01",
          active: false,
          variations: [0, 1, 2, 3],
          urlPatterns: [
            {
              include: true,
              pattern: "http://app.customer.com",
              type: "simple",
            },
          ],
        }).variationId
      ).toEqual(1);

      window.location.href = "http://app.customer.com?exp-01=3";
      expect(
        growthbook.run({
          key: "exp-01",
          active: false,
          variations: [0, 1, 2, 3],
          urlPatterns: [
            {
              include: true,
              pattern: "http://app.customer.com",
              type: "simple",
            },
          ],
        }).variationId
      ).toEqual(3);
    });
  });
});
