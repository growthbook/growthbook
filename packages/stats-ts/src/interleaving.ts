import binomial from "@stdlib/stats/base/dists/binomial";
import { FrequentistTestResult } from "./results";
import { normQuantile, tCdf, tQuantile } from "./utils";

// ---------------------------------------------------------------------------
// Estimators for interleaving experiments. Both return the standard
// FrequentistTestResult so results map onto SnapshotMetric uniformly.
//
// pairedDeltaTest: DoorDash-style paired analysis. Requires engagement events
//   joinable to impressions via interleave_id. Inputs are cross-user joint
//   sufficient statistics of the per-user triple (X, Y, N): X = credited
//   metric total on treatment-drafted competitive items, Y = same for
//   control, N = shared competitive-exposure denominator.
//
// ownershipSignTest: Airbnb-style fallback (arXiv:2508.00751) when no
//   interleave_id exists. Engagement is attributed by per-user item-ownership
//   shares; each user reduces to the sign of (treatment wins - control wins);
//   the test is a binomial sign test over non-tied users.
// ---------------------------------------------------------------------------

// Cross-user joint sufficient statistics for the paired estimator.
// One object per (metric, dimension); field names match the SQL output.
export interface PairedSufficientStats {
  users: number;
  sum_x: number;
  sum_xx: number;
  sum_y: number;
  sum_yy: number;
  sum_n: number;
  sum_nn: number;
  sum_xy: number;
  sum_xn: number;
  sum_yn: number;
}

// Per-user preference counts for the ownership estimator.
export interface OwnershipCounts {
  users_pref_treatment: number;
  users_pref_control: number;
  users_tied: number;
}

function errorResult(errorMessage: string): FrequentistTestResult {
  return {
    expected: 0,
    ci: [null, null],
    uplift: { dist: "normal", mean: 0, stddev: 0 },
    errorMessage,
    pValue: null,
    pValueErrorMessage: null,
  };
}

// Paired t-test via the delta method on the absolute difference in
// exposure-weighted credited rates: delta = (mean(X) - mean(Y)) / mean(N).
// The -2*Cov(X, Y) term is the paired-design variance reduction.
export function pairedDeltaTest(
  stats: PairedSufficientStats,
  alpha: number = 0.05,
): FrequentistTestResult {
  const n = stats.users;
  if (n < 2) {
    return errorResult("NOT_ENOUGH_USERS");
  }

  const mx = stats.sum_x / n;
  const my = stats.sum_y / n;
  const mn = stats.sum_n / n;
  if (mn <= 0) {
    return errorResult("NO_COMPETITIVE_EXPOSURES");
  }

  // Sample (co)variances with n-1 denominator
  const covdiv = n - 1;
  const varX = (stats.sum_xx - (stats.sum_x * stats.sum_x) / n) / covdiv;
  const varY = (stats.sum_yy - (stats.sum_y * stats.sum_y) / n) / covdiv;
  const varN = (stats.sum_nn - (stats.sum_n * stats.sum_n) / n) / covdiv;
  const covXY = (stats.sum_xy - (stats.sum_x * stats.sum_y) / n) / covdiv;
  const covXN = (stats.sum_xn - (stats.sum_x * stats.sum_n) / n) / covdiv;
  const covYN = (stats.sum_yn - (stats.sum_y * stats.sum_n) / n) / covdiv;

  const est = (mx - my) / mn;
  const perUnitVariance =
    (varX + varY - 2 * covXY) / mn ** 2 -
    (2 * (mx - my) * (covXN - covYN)) / mn ** 3 +
    ((mx - my) ** 2 * varN) / mn ** 4;
  const variance = Math.max(perUnitVariance, 0) / n;
  if (variance <= 0) {
    return errorResult("ZERO_VARIANCE");
  }

  const se = Math.sqrt(variance);
  const dof = n - 1;
  const tStat = est / se;
  const pValue = 2 * tCdf(-Math.abs(tStat), dof);
  const halfWidth = tQuantile(1 - alpha / 2, dof) * se;

  return {
    expected: est,
    ci: [est - halfWidth, est + halfWidth],
    uplift: { dist: "normal", mean: est, stddev: se },
    errorMessage: null,
    pValue,
    pValueErrorMessage: null,
  };
}

// Sign test over per-user preferences. The estimand is the net preference
// share tau = (P(prefer T) - P(prefer C)) across all users (ties contribute
// zero); the test conditions on non-tied users (exact binomial vs p = 1/2).
export function ownershipSignTest(
  counts: OwnershipCounts,
  alpha: number = 0.05,
): FrequentistTestResult {
  const nT = counts.users_pref_treatment;
  const nC = counts.users_pref_control;
  const nTotal = nT + nC + counts.users_tied;
  const m = nT + nC;
  if (nTotal < 2 || m < 1) {
    return errorResult("NOT_ENOUGH_USERS");
  }

  // Exact two-sided binomial sign test on non-tied users
  const k = Math.min(nT, nC);
  const pValue = Math.min(1, 2 * binomial.cdf(k, m, 0.5));

  // Net preference share over ALL users, with a normal-approximation CI
  // from the non-tied preference proportion transformed to the tau scale
  const est = (nT - nC) / nTotal;
  const pHat = nT / m;
  const seP = Math.sqrt(Math.max(pHat * (1 - pHat), 1e-12) / m);
  const scale = (2 * m) / nTotal; // d(tau)/d(p)
  const seTau = seP * scale;
  const halfWidth = normQuantile(1 - alpha / 2) * seTau;

  return {
    expected: est,
    ci: [est - halfWidth, est + halfWidth],
    uplift: { dist: "normal", mean: est, stddev: seTau },
    errorMessage: null,
    pValue,
    pValueErrorMessage: null,
  };
}
