import { DEFAULT_PROPER_PRIOR_STDDEV } from "shared/constants";
import {
  validateMetricOverrides,
  validatePriorSettings,
  healPriorSettings,
  healMetricOverrides,
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

  describe("healPriorSettings", () => {
    it("heals stddev=0 to DEFAULT", () => {
      const settings = {
        override: false,
        proper: true,
        mean: 0,
        stddev: 0,
      };
      healPriorSettings(settings);
      expect(settings.stddev).toBe(DEFAULT_PROPER_PRIOR_STDDEV);
    });

    it("heals a negative stddev to DEFAULT", () => {
      const settings = { override: false, proper: true, mean: 0, stddev: -1 };
      healPriorSettings(settings);
      expect(settings.stddev).toBe(DEFAULT_PROPER_PRIOR_STDDEV);
    });

    it("heals a NaN stddev to DEFAULT", () => {
      const settings = { override: false, proper: true, mean: 0, stddev: NaN };
      healPriorSettings(settings);
      expect(settings.stddev).toBe(DEFAULT_PROPER_PRIOR_STDDEV);
    });

    it("is idempotent on an already-default stddev", () => {
      const settings = {
        override: false,
        proper: true,
        mean: 0,
        stddev: DEFAULT_PROPER_PRIOR_STDDEV,
      };
      healPriorSettings(settings);
      expect(settings.stddev).toBe(DEFAULT_PROPER_PRIOR_STDDEV);
    });

    it("leaves a positive stddev unchanged", () => {
      const settings = {
        override: false,
        proper: true,
        mean: 0,
        stddev: 0.5,
      };
      healPriorSettings(settings);
      expect(settings.stddev).toBe(0.5);
    });

    it("is a no-op on undefined", () => {
      expect(() => healPriorSettings(undefined)).not.toThrow();
    });
  });

  describe("healMetricOverrides", () => {
    it("heals properPriorStdDev=0 to DEFAULT for the right override", () => {
      const overrides = [
        { id: "m1", properPriorStdDev: 0.5 },
        { id: "m2", properPriorStdDev: 0 },
      ];
      healMetricOverrides(overrides);
      expect(overrides[0].properPriorStdDev).toBe(0.5);
      expect(overrides[1].properPriorStdDev).toBe(DEFAULT_PROPER_PRIOR_STDDEV);
    });

    it("leaves a positive value unchanged", () => {
      const overrides = [{ id: "m1", properPriorStdDev: 0.3 }];
      healMetricOverrides(overrides);
      expect(overrides[0].properPriorStdDev).toBe(0.3);
    });

    it("leaves an undefined properPriorStdDev as undefined", () => {
      const overrides = [{ id: "m1", properPriorStdDev: undefined }];
      healMetricOverrides(overrides);
      expect(overrides[0].properPriorStdDev).toBeUndefined();
    });

    it("is a no-op on undefined overrides", () => {
      expect(() => healMetricOverrides(undefined)).not.toThrow();
    });

    it("is a no-op on empty overrides array", () => {
      expect(() => healMetricOverrides([])).not.toThrow();
    });
  });
});
