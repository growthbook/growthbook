// Canonical result shapes returned by the TypeScript stats engine (stats-ts).
// Owned here, not in stats-ts, so packages that persist or validate these
// results can reference them without importing stats-ts — shared cannot depend
// on stats-ts (stats-ts already depends on shared, and the reverse would be a
// workspace cycle).
//
// Distinct from ./stats.d.ts, which describes the gbstats (Python) payloads:
// those are all-optional with a non-nullable `ci` and are NOT interchangeable.

export interface Uplift {
  dist: string;
  mean: number;
  stddev: number;
}

// Null bounds mean unbounded on that side.
export type ResponseCI = [number | null, number | null];

export interface TestResult {
  expected: number;
  ci: ResponseCI;
  uplift: Uplift;
  errorMessage: string | null;
}

export type PValueErrorMessage =
  | "NUMERICAL_PVALUE_NOT_CONVERGED"
  | "ALPHA_GREATER_THAN_0.5_FOR_SEQUENTIAL_ONE_SIDED_TEST";

export interface FrequentistTestResult extends TestResult {
  pValue: number | null;
  pValueErrorMessage: PValueErrorMessage | null;
}

// Which test produced an interleaving result. The analysis type alone does not
// say: both tests return the same shape, but the sign test's interval is exact
// (not Wald) and its estimand is conditional on non-tied users, so consumers
// need to know which one they are reading.
export type InterleavingTestMethod = "paired_delta_t" | "exact_binomial_sign";

// Interleaving results are CI-first by design and carry no `uplift`. The sign
// test's Clopper-Pearson interval is asymmetric, so no single stddev describes
// it, and the paired interval is a t-interval (dof = users - 1), not a normal.
// The CI and p-value are the uncertainty statement.
export interface InterleavingTestResult
  extends Omit<FrequentistTestResult, "uplift"> {
  method: InterleavingTestMethod;
}
