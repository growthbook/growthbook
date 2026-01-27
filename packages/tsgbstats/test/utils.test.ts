/**
 * Tests for utility functions.
 */

import {
  frequentistDiff,
  frequentistVariance,
  varianceOfRatios,
  multinomialCovariance,
  isStatisticallySignificant,
} from "../src/utils";
import {
  loadUtilsFixtures,
  getTestCase,
  FixtureFile,
} from "./helpers/fixtureLoader";
import { approxEqual } from "./helpers/testUtils";

describe("frequentistDiff", () => {
  it("should compute relative difference correctly", () => {
    const diff = frequentistDiff(10, 12, true);
    expect(diff).toBe(0.2); // (12 - 10) / 10
  });

  it("should compute absolute difference correctly", () => {
    const diff = frequentistDiff(10, 12, false);
    expect(diff).toBe(2); // 12 - 10
  });

  it("should use unadjusted mean for relative difference when provided", () => {
    const diff = frequentistDiff(10, 12, true, 8);
    expect(diff).toBe(0.25); // (12 - 10) / 8
  });

  it("should return 0 for relative difference when baseline is 0", () => {
    const diff = frequentistDiff(0, 12, true, 0);
    expect(diff).toBe(0);
  });
});

describe("frequentistVariance", () => {
  it("should compute absolute variance correctly", () => {
    const variance = frequentistVariance(1, 10, 100, 2, 12, 100, false);
    expect(variance).toBe(0.03); // 1/100 + 2/100
  });

  it("should compute relative variance using delta method", () => {
    const variance = frequentistVariance(1, 10, 100, 2, 12, 100, true);
    // Uses varianceOfRatios with covariance = 0
    expect(variance > 0).toBe(true);
  });
});

describe("varianceOfRatios", () => {
  it("should return 0 when denominator mean is 0", () => {
    expect(varianceOfRatios(10, 1, 0, 1, 0)).toBe(0);
  });

  it("should compute variance correctly", () => {
    // M/D where M has mean=10, var=1; D has mean=5, var=0.5; cov=0.2
    const variance = varianceOfRatios(10, 1, 5, 0.5, 0.2);
    // Formula: var_m/mean_d^2 + var_d*mean_m^2/mean_d^4 - 2*cov*mean_m/mean_d^3
    // = 1/25 + 0.5*100/625 - 2*0.2*10/125
    // = 0.04 + 0.08 - 0.032
    // = 0.088
    expect(approxEqual(variance, 0.088)).toBe(true);
  });
});

describe("multinomialCovariance", () => {
  let fixtures: FixtureFile;

  beforeAll(() => {
    try {
      fixtures = loadUtilsFixtures();
    } catch {
      // Skip tests if fixtures don't exist
    }
  });

  it("should compute covariance matrix correctly", () => {
    if (!fixtures) {
      console.log("Fixtures not found, run pnpm fixtures:generate first");
      return;
    }
    const testCase = getTestCase(
      fixtures,
      "multinomial_covariance",
      "test_multinomial_covariance",
    );
    const nu = testCase.inputs.nu as number[];

    const result = multinomialCovariance(nu);
    const expected = testCase.expected.covariance as number[][];

    // Check dimensions
    expect(result.length).toBe(expected.length);

    // Check values
    for (let i = 0; i < result.length; i++) {
      for (let j = 0; j < result[i].length; j++) {
        expect(approxEqual(result[i][j], expected[i][j], 1e-10)).toBe(true);
      }
    }
  });

  it("should have diagonal elements nu[i] * (1 - nu[i])", () => {
    const nu = [0.2, 0.3, 0.5];
    const result = multinomialCovariance(nu);

    for (let i = 0; i < nu.length; i++) {
      expect(approxEqual(result[i][i], nu[i] * (1 - nu[i]))).toBe(true);
    }
  });

  it("should have off-diagonal elements -nu[i] * nu[j]", () => {
    const nu = [0.2, 0.3, 0.5];
    const result = multinomialCovariance(nu);

    for (let i = 0; i < nu.length; i++) {
      for (let j = 0; j < nu.length; j++) {
        if (i !== j) {
          expect(approxEqual(result[i][j], -nu[i] * nu[j])).toBe(true);
        }
      }
    }
  });
});

describe("isStatisticallySignificant", () => {
  it("should return true when CI excludes 0 (positive)", () => {
    expect(isStatisticallySignificant([0.1, 0.5])).toBe(true);
  });

  it("should return true when CI excludes 0 (negative)", () => {
    expect(isStatisticallySignificant([-0.5, -0.1])).toBe(true);
  });

  it("should return false when CI includes 0", () => {
    expect(isStatisticallySignificant([-0.1, 0.5])).toBe(false);
  });

  it("should return false when CI touches 0", () => {
    expect(isStatisticallySignificant([0, 0.5])).toBe(false);
    expect(isStatisticallySignificant([-0.5, 0])).toBe(false);
  });
});
