import binomial from "@stdlib/stats/base/dists/binomial";
import { FrequentistTestResult } from "./results";
import { normQuantile, tCdf, tQuantile } from "./utils";

// ---------------------------------------------------------------------------
// Estimators for interleaving experiments. Both return the standard
// FrequentistTestResult so results map onto SnapshotMetric uniformly.
//
// pairedDeltaTest: Paired delta-method t-test. Requires engagement events
//   joinable to impressions via ranking_id. Inputs are cross-user joint
//   sufficient statistics of the per-user triple (treatment, control,
//   exposures): credited metric total on treatment-drafted competitive
//   items, the same on control-drafted items, and the shared
//   competitive-exposure denominator.
//
// ownershipSignTest: Airbnb-style (arXiv:2508.00751). Engagement is
//   attributed by per-user item-ownership shares (from exposure counts);
//   each user reduces to the sign of (treatment wins -
//   control wins); the test is a binomial sign test over non-tied users.
// ---------------------------------------------------------------------------

// Cross-user joint sufficient statistics for the paired estimator.
// One object per (metric, dimension); field names match the SQL output.
export interface PairedSufficientStats {
  users: number;
  treatment_sum: number;
  treatment_sum_squares: number;
  control_sum: number;
  control_sum_squares: number;
  exposures_sum: number;
  exposures_sum_squares: number;
  treatment_control_sum_product: number;
  treatment_exposures_sum_product: number;
  control_exposures_sum_product: number;
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
// exposure-weighted credited rates:
// delta = (mean(treatment) - mean(control)) / mean(exposures).
// The -2*Cov(treatment, control) term is the paired-design variance reduction.
export function pairedDeltaTest(
  stats: PairedSufficientStats,
  alpha: number = 0.05,
): FrequentistTestResult {
  const users = stats.users;
  if (users < 2) {
    return errorResult("NOT_ENOUGH_USERS");
  }

  const meanT = stats.treatment_sum / users;
  const meanC = stats.control_sum / users;
  const meanN = stats.exposures_sum / users;
  if (meanN <= 0) {
    return errorResult("NO_COMPETITIVE_EXPOSURES");
  }

  // Sample (co)variances with users-1 denominator
  const covdiv = users - 1;
  const varT =
    (stats.treatment_sum_squares -
      (stats.treatment_sum * stats.treatment_sum) / users) /
    covdiv;
  const varC =
    (stats.control_sum_squares -
      (stats.control_sum * stats.control_sum) / users) /
    covdiv;
  const varN =
    (stats.exposures_sum_squares -
      (stats.exposures_sum * stats.exposures_sum) / users) /
    covdiv;
  const covTC =
    (stats.treatment_control_sum_product -
      (stats.treatment_sum * stats.control_sum) / users) /
    covdiv;
  const covTN =
    (stats.treatment_exposures_sum_product -
      (stats.treatment_sum * stats.exposures_sum) / users) /
    covdiv;
  const covCN =
    (stats.control_exposures_sum_product -
      (stats.control_sum * stats.exposures_sum) / users) /
    covdiv;

  const est = (meanT - meanC) / meanN;
  const perUnitVariance =
    (varT + varC - 2 * covTC) / meanN ** 2 -
    (2 * (meanT - meanC) * (covTN - covCN)) / meanN ** 3 +
    ((meanT - meanC) ** 2 * varN) / meanN ** 4;
  const variance = Math.max(perUnitVariance, 0) / users;
  if (variance <= 0) {
    return errorResult("ZERO_VARIANCE");
  }

  const se = Math.sqrt(variance);
  const dof = users - 1;
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
