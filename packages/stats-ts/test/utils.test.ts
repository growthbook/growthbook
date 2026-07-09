import {
  invertSymmetricMatrix,
  multinomialCovariance,
  normCdf,
  normPdf,
  normPpf,
  randomNormal,
} from "../src/utils";

describe("multinomialCovariance", () => {
  const nu = [0.1, 0.2, 0.25, 0.15, 0.3];

  it("equals diag(nu) - outer(nu, nu)", () => {
    const v = multinomialCovariance(nu);
    for (let i = 0; i < nu.length; i++) {
      for (let j = 0; j < nu.length; j++) {
        const expected = (i === j ? nu[i] : 0) - nu[i] * nu[j];
        expect(v[i][j]).toBeCloseTo(expected, 12);
      }
    }
  });

  it("is symmetric with zero row sums and nu_i*(1-nu_i) on the diagonal", () => {
    const v = multinomialCovariance(nu);
    for (let i = 0; i < nu.length; i++) {
      expect(v[i][i]).toBeCloseTo(nu[i] * (1 - nu[i]), 12);
      const rowSum = v[i].reduce((a, b) => a + b, 0);
      expect(rowSum).toBeCloseTo(0, 12);
      for (let j = 0; j < nu.length; j++) {
        expect(v[i][j]).toBeCloseTo(v[j][i], 12);
      }
    }
  });
});

describe("normPpf", () => {
  it("inverts normCdf", () => {
    for (const z of [-2.5, -1.0, -0.25, 0, 0.25, 1.0, 2.5]) {
      expect(normPpf(normCdf(z))).toBeCloseTo(z, 4);
    }
  });

  it("matches known quantiles", () => {
    expect(normPpf(0.975)).toBeCloseTo(1.959964, 4);
    expect(normPpf(0.5)).toBeCloseTo(0, 6);
  });
});

describe("invertSymmetricMatrix", () => {
  it("inverts a symmetric positive-definite matrix", () => {
    const v = [
      [4, 1, 0],
      [1, 3, 1],
      [0, 1, 2],
    ];
    const result = invertSymmetricMatrix(v);
    expect(result.success).toBe(true);
    const inv = result.inverse!;

    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        let sum = 0;
        for (let k = 0; k < 3; k++) sum += v[i][k] * inv[k][j];
        expect(sum).toBeCloseTo(i === j ? 1 : 0, 9);
      }
    }
  });

  it("fails for a non-square matrix", () => {
    const result = invertSymmetricMatrix([
      [1, 0],
      [0, 1],
      [0, 0],
    ]);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/square/);
  });

  it("fails for a non-positive-definite matrix", () => {
    const result = invertSymmetricMatrix([
      [1, 2],
      [2, 1],
    ]);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/positive-definite/);
  });
});

describe("randomNormal", () => {
  function sampleQuantile(sorted: number[], p: number): number {
    const idx = (sorted.length - 1) * p;
    const lo = Math.floor(idx);
    const hi = Math.ceil(idx);
    if (lo === hi) return sorted[lo];
    return sorted[lo] + (idx - lo) * (sorted[hi] - sorted[lo]);
  }

  it("produces tail quantiles that match the theoretical normal", () => {
    const mu = 3;
    const sigma = Math.sqrt(2);
    const nSamples = 1e7;

    const samples = randomNormal(nSamples, mu, sigma);
    samples.sort((a, b) => a - b);

    const N_STANDARD_ERRORS = 6;

    for (const q of [0.0001, 0.9999]) {
      const qTheoretical = normPpf(q, mu, sigma);
      const density = normPdf(qTheoretical, mu, sigma);
      const tolerance = Math.sqrt((q * (1 - q)) / (nSamples * density ** 2));
      const qSamp = sampleQuantile(samples, q);

      expect(Math.abs(qSamp - qTheoretical)).toBeLessThan(
        N_STANDARD_ERRORS * tolerance,
      );
    }
  }, 60000);
});
