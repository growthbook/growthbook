import normal from "@stdlib/stats/base/dists/normal";

export function randomNormal(
  nSamples: number,
  mu: number,
  sigma: number,
): number[] {
  const u1 = Array.from({ length: nSamples }, () => Math.random());
  const u2 = Array.from({ length: nSamples }, () => Math.random());
  return u1.map((u, i) => {
    const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * u2[i]);
    return mu + sigma * z;
  });
}

/** Standard normal probability density function. */
export function normPdf(x: number, loc = 0, scale = 1): number {
  const z = (x - loc) / scale;
  return Math.exp(-0.5 * z * z) / (scale * Math.sqrt(2 * Math.PI));
}

/** Normal cumulative distribution function (exact, via `@stdlib`). */
export function normCdf(x: number, loc = 0, scale = 1): number {
  return normal.cdf(x, loc, scale);
}

/** Inverse standard normal CDF via Acklam's rational approximation (rel err < 1.15e-9). */
export function normPpf(p: number, loc = 0, scale = 1): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;

  const a = [
    -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2,
    1.38357751867269e2, -3.066479806614716e1, 2.506628277459239,
  ];
  const b = [
    -5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2,
    6.680131188771972e1, -1.328068155288572e1,
  ];
  const c = [
    -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838,
    -2.549732539343734, 4.374664141464968, 2.938163982698783,
  ];
  const d = [
    7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996,
    3.754408661907416,
  ];

  const pLow = 0.02425;
  const pHigh = 1 - pLow;

  let z: number;
  if (p < pLow) {
    const q = Math.sqrt(-2 * Math.log(p));
    z =
      (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  } else if (p <= pHigh) {
    const q = p - 0.5;
    const r = q * q;
    z =
      ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) *
        q) /
      (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  } else {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    z = -(
      (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    );
  }
  return loc + scale * z;
}

export function frequentistDiff(
  meanA: number,
  meanB: number,
  relative: boolean,
  meanAUnadjusted?: number,
): number {
  const base = meanAUnadjusted ? meanAUnadjusted : meanA;
  if (relative) {
    return (meanB - meanA) / base;
  }
  return meanB - meanA;
}

export function frequentistVariance(
  varA: number,
  meanA: number,
  nA: number,
  varB: number,
  meanB: number,
  nB: number,
  relative: boolean,
): number {
  if (relative) {
    return varianceOfRatios(meanB, varB / nB, meanA, varA / nA, 0);
  }
  return varB / nB + varA / nA;
}

/** Delta-method variance of M / D given moments and covariance. */
export function varianceOfRatios(
  meanM: number,
  varM: number,
  meanD: number,
  varD: number,
  covMD: number,
): number {
  if (meanD === 0) return 0;
  return (
    varM / meanD ** 2 +
    (varD * meanM ** 2) / meanD ** 4 -
    (2 * covMD * meanM) / meanD ** 3
  );
}

export function gaussianCredibleInterval(
  meanDiff: number,
  stdDiff: number,
  alpha: number,
): [number, number] {
  return [
    normPpf(alpha / 2, meanDiff, stdDiff),
    normPpf(1 - alpha / 2, meanDiff, stdDiff),
  ];
}

/** Per-element pooled mean of two groups; 0 where both counts are 0. */
export function weightedMean(
  n0: number[],
  n1: number[],
  mn0: number[],
  mn1: number[],
): number[] {
  return mn0.map((_, i) => {
    const denom = n0[i] + n1[i];
    if (denom > 0) {
      return (n0[i] * mn0[i] + n1[i] * mn1[i]) / denom;
    }
    return 0;
  });
}

export function isStatisticallySignificant(ci: number[]): boolean {
  return ci[0] > 0 || ci[1] < 0;
}

/** Covariance matrix of X ~ multinomial(1, nu): diag(nu) - outer(nu, nu). */
export function multinomialCovariance(nu: number[]): number[][] {
  return nu.map((ni, i) => nu.map((nj, j) => (i === j ? ni : 0) - ni * nj));
}

export type MatrixInversionResult = {
  success: boolean;
  inverse?: number[][];
  error?: string;
};

function choleskyLower(v: number[][]): number[][] | null {
  const n = v.length;
  const l: number[][] = Array.from({ length: n }, () =>
    new Array<number>(n).fill(0),
  );
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = v[i][j];
      for (let k = 0; k < j; k++) {
        sum -= l[i][k] * l[j][k];
      }
      if (i === j) {
        if (sum <= 0) return null;
        l[i][j] = Math.sqrt(sum);
      } else {
        l[i][j] = sum / l[j][j];
      }
    }
  }
  return l;
}

function invertLowerTriangular(l: number[][]): number[][] {
  const n = l.length;
  const x: number[][] = Array.from({ length: n }, () =>
    new Array<number>(n).fill(0),
  );
  for (let i = 0; i < n; i++) {
    x[i][i] = 1 / l[i][i];
    for (let j = 0; j < i; j++) {
      let s = 0;
      for (let k = j; k < i; k++) {
        s += l[i][k] * x[k][j];
      }
      x[i][j] = -s / l[i][i];
    }
  }
  return x;
}

/** Invert a symmetric positive-definite matrix via Cholesky; returns a result instead of throwing. */
export function invertSymmetricMatrix(v: number[][]): MatrixInversionResult {
  const n = v.length;
  if (v.some((row) => row.length !== n)) {
    return { success: false, error: "Input matrix must be square." };
  }

  const l = choleskyLower(v);
  if (l === null) {
    return { success: false, error: "Matrix is not positive-definite." };
  }

  const lInv = invertLowerTriangular(l);
  const inverse: number[][] = Array.from({ length: n }, () =>
    new Array<number>(n).fill(0),
  );
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      let sum = 0;
      for (let k = 0; k < n; k++) {
        sum += lInv[k][i] * lInv[k][j];
      }
      inverse[i][j] = sum;
    }
  }

  return { success: true, inverse };
}
