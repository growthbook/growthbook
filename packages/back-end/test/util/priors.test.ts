import {
  validateMetricOverrides,
  validatePriorSettings,
} from "back-end/src/util/priors";

describe("priors util", () => {
  describe("validatePriorSettings", () => {
    it("allows positive stddev", () => {
      expect(() => validatePriorSettings({ stddev: 0.5 })).not.toThrow();
    });

    it("allows undefined stddev", () => {
      expect(() => validatePriorSettings({ stddev: undefined })).not.toThrow();
    });

    it("allows undefined priorSettings", () => {
      expect(() => validatePriorSettings(undefined)).not.toThrow();
    });

    it("rejects stddev = 0", () => {
      expect(() => validatePriorSettings({ stddev: 0 })).toThrow(
        "Prior standard deviation must be greater than 0",
      );
    });

    it("rejects negative stddev", () => {
      expect(() => validatePriorSettings({ stddev: -1 })).toThrow(
        "Prior standard deviation must be greater than 0",
      );
    });

    it("rejects NaN stddev", () => {
      expect(() => validatePriorSettings({ stddev: NaN })).toThrow(
        "Prior standard deviation must be greater than 0",
      );
    });
  });

  describe("validateMetricOverrides", () => {
    it("allows positive properPriorStdDev", () => {
      expect(() =>
        validateMetricOverrides([
          { id: "m1", properPriorStdDev: 0.3 },
          { id: "m2", properPriorStdDev: 0.5 },
        ]),
      ).not.toThrow();
    });

    it("allows undefined properPriorStdDev", () => {
      expect(() =>
        validateMetricOverrides([{ id: "m1", properPriorStdDev: undefined }]),
      ).not.toThrow();
    });

    it("allows empty overrides", () => {
      expect(() => validateMetricOverrides([])).not.toThrow();
    });

    it("allows undefined overrides", () => {
      expect(() => validateMetricOverrides(undefined)).not.toThrow();
    });

    it("rejects stddev = 0 and names the metric", () => {
      expect(() =>
        validateMetricOverrides([
          { id: "m1", properPriorStdDev: 0.3 },
          { id: "bad_metric", properPriorStdDev: 0 },
        ]),
      ).toThrow(
        "Prior standard deviation must be greater than 0 for metric bad_metric",
      );
    });

    it("rejects negative stddev and names the metric", () => {
      expect(() =>
        validateMetricOverrides([{ id: "m1", properPriorStdDev: -0.5 }]),
      ).toThrow(
        "Prior standard deviation must be greater than 0 for metric m1",
      );
    });

    it("rejects NaN stddev and names the metric", () => {
      expect(() =>
        validateMetricOverrides([{ id: "bad_metric", properPriorStdDev: NaN }]),
      ).toThrow(
        "Prior standard deviation must be greater than 0 for metric bad_metric",
      );
    });
  });
});
