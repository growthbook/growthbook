import binomial from "@stdlib/stats/base/dists/binomial";
import { FrequentistTestResult } from "./results";
import { betaQuantile, tCdf, tQuantile } from "./utils";

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
// preferenceSignTest: Airbnb-style (arXiv:2508.00751). Engagement is
//   attributed by each user's per-item exposure shares;
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

// Per-user preference counts for preferenceSignTest.
export interface PreferenceCounts {
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

// Sign test over non-tied per-user preferences. The estimand is the net
// preference share tau = P(prefer T) - P(prefer C), conditional on expressing
// a preference; the exact test and interval use the same binomial sample.
export function preferenceSignTest(
  counts: PreferenceCounts,
  alpha: number = 0.05,
): FrequentistTestResult {
  const nT = counts.users_pref_treatment;
  const nC = counts.users_pref_control;
  const m = nT + nC;
  if (m < 2) {
    return errorResult("NOT_ENOUGH_USERS");
  }

  // Exact two-sided binomial sign test on non-tied users
  const k = Math.min(nT, nC);
  const pValue = Math.min(1, 2 * binomial.cdf(k, m, 0.5));

  // Transform the Clopper-Pearson interval for p to tau = 2p - 1. It inverts
  // the same exact test, so the interval and p-value agree about zero.
  const est = (nT - nC) / m;
  const pLo = nT === 0 ? 0 : betaQuantile(alpha / 2, nT, m - nT + 1);
  const pHi = nT === m ? 1 : betaQuantile(1 - alpha / 2, nT + 1, m - nT);

  // Asymmetric, so no single stddev describes it. Report the Wald SE for
  // consumers that need a normal summary; the CI above is authoritative.
  const pHat = nT / m;
  const seTau = 2 * Math.sqrt((pHat * (1 - pHat)) / m);

  return {
    expected: est,
    ci: [2 * pLo - 1, 2 * pHi - 1],
    uplift: { dist: "normal", mean: est, stddev: seTau },
    errorMessage: null,
    pValue,
    pValueErrorMessage: null,
  };
}
