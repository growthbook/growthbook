import { GrowthBook } from "../src";
import { Options } from "../src/types/growthbook";

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
      const options: Options = { user: { id: "1" } };
      const growthbook = new GrowthBook(options);
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
        }).inExperiment,
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
        }).inExperiment,
      ).toEqual(false);
    });

    it("should match the variation index with the index supplied via query param", () => {
      window.location.href = "http://app.customer.com?exp-01=1";
      const options: Options = { user: { id: "1" } };
      const growthbook = new GrowthBook(options);
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
        }).variationId,
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
        }).variationId,
      ).toEqual(3);
    });

    describe("when the experiment has multiple visual changesets", () => {
      it("should select the experiment with the url pattern that matches", () => {
        window.location.href = "http://app.customer.com?exp-01=1";
        const options: Options = { user: { id: "1" } };
        const growthbook = new GrowthBook(options);
        expect(
          growthbook.run({
            key: "exp-01",
            active: false,
            variations: [0, 1],
            urlPatterns: [
              {
                include: true,
                pattern: "http://app.customer.com/path/1",
                type: "simple",
              },
            ],
          }).inExperiment,
        ).toEqual(false);

        expect(
          growthbook.run({
            key: "exp-01",
            active: false,
            variations: [0, 1],
            urlPatterns: [
              {
                include: true,
                pattern: "http://app.customer.com/path/2",
                type: "simple",
              },
            ],
          }).inExperiment,
        ).toEqual(false);

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
          }).inExperiment,
        ).toEqual(true);
      });
    });
  });
});
