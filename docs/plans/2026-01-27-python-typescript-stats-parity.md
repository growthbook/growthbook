# Python-TypeScript Stats Engine Parity Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Achieve full parity between Python `gbstats` and TypeScript `tsgbstats` by fixing missing fields and reducing numerical differences.

**Architecture:** Fix three categories of issues: (1) missing `businessMetricType` field causing `power` to not compute, (2) hardcoded `realizedSettings` that should come from test results, (3) numerical precision differences in Bayesian calculations using more stable math operations.

**Tech Stack:** TypeScript, @stdlib statistical libraries, Python/scipy for reference

---

## Summary of Issues

Running `pnpm compare-stats` in `packages/back-end` reveals 946 differences:

| Issue Category            | Fields Affected                                   | Root Cause                                                              |
| ------------------------- | ------------------------------------------------- | ----------------------------------------------------------------------- |
| Missing field mapping     | `power`                                           | `businessMetricType` not passed in `statsShadow.ts`                     |
| Hardcoded value           | `realizedSettings.postStratificationApplied`      | Hardcoded to `false` instead of using `momentsResult`                   |
| Missing in all variations | `supplementalResults`                             | Already implemented but needs verification                              |
| Numerical precision       | `chanceToWin`, `risk`, `ci`, `expected`, `stddev` | Using `1 - CDF()` instead of survival function; manual truncated normal |

---

## Task 1: Add `businessMetricType` to Metric Settings Conversion

**Files:**

- Modify: `packages/back-end/src/services/statsShadow.ts:76-100`
- Test: Run `pnpm compare-stats` in `packages/back-end`

**Step 1: Read the current implementation**

Check the current `convertMetricSettings` function to understand the structure.

**Step 2: Add businessMetricType mapping**

In `packages/back-end/src/services/statsShadow.ts`, add the `businessMetricType` field to the `convertMetricSettings` function:

```typescript
export function convertMetricSettings(
  python: PythonMetricSettings,
): TsMetricSettings {
  return {
    id: python.id,
    name: python.name,
    inverse: python.inverse,
    statisticType: python.statistic_type,
    mainMetricType: python.main_metric_type as "count" | "binomial",
    denominatorMetricType: python.denominator_metric_type as
      | "count"
      | "binomial"
      | undefined,
    covariateMetricType: python.covariate_metric_type as
      | "count"
      | "binomial"
      | undefined,
    quantileValue: python.quantile_value,
    priorMean: python.prior_mean,
    priorStddev: python.prior_stddev,
    priorProper: python.prior_proper,
    targetMde: python.target_mde,
    keepTheta: python.keep_theta,
    // ADD THIS LINE: Convert array to string for goal detection
    businessMetricType: Array.isArray(python.business_metric_type)
      ? python.business_metric_type.join(",")
      : python.business_metric_type,
  };
}
```

**Step 3: Verify the Python type definition includes business_metric_type**

Check `packages/shared/types/stats.ts` or wherever `PythonMetricSettings` is defined to ensure `business_metric_type` is included.

**Step 4: Run compare-stats to verify power is now computed**

```bash
cd packages/back-end && pnpm compare-stats
```

Expected: `power: missing in TS` errors should be reduced or eliminated for metrics with `business_metric_type` containing "goal".

**Step 5: Commit**

```bash
git add packages/back-end/src/services/statsShadow.ts
git commit -m "fix(statsShadow): add businessMetricType to metric settings conversion

Fixes power calculation not running because businessMetricType was not
being passed from Python snake_case to TypeScript camelCase format.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 2: Fix Hardcoded `realizedSettings.postStratificationApplied`

**Files:**

- Modify: `packages/tsgbstats/src/gbstats.ts:765-767`
- Reference: `packages/tsgbstats/src/frequentist/postStratification.ts` (EffectMoments)

**Step 1: Understand the data flow**

The `realizedSettings.postStratificationApplied` should come from `test.momentsResult.postStratificationApplied`. Currently it's hardcoded:

```typescript
realizedSettings: {
  postStratificationApplied: false,  // HARDCODED - WRONG
},
```

**Step 2: Update analyzeMetricDf to use momentsResult**

In `packages/tsgbstats/src/gbstats.ts`, around line 765-767, change:

```typescript
// BEFORE (wrong)
realizedSettings: {
  postStratificationApplied: false,
},

// AFTER (correct)
realizedSettings: {
  postStratificationApplied: test.momentsResult?.postStratificationApplied ?? false,
},
```

**Step 3: Verify EffectMomentsResult has postStratificationApplied**

Check `packages/tsgbstats/src/models/results.ts` to confirm the interface includes this field.

**Step 4: Run compare-stats**

```bash
cd packages/back-end && pnpm compare-stats
```

Expected: `realizedSettings: missing in TS` errors should be eliminated.

**Step 5: Commit**

```bash
git add packages/tsgbstats/src/gbstats.ts
git commit -m "fix(tsgbstats): use actual postStratificationApplied from moments result

Instead of hardcoding realizedSettings.postStratificationApplied to false,
use the actual value from the test's momentsResult.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 3: Add Numerically Stable Survival Function for chanceToWin

**Files:**

- Modify: `packages/tsgbstats/src/bayesian/tests.ts:173-177`
- Modify: `packages/tsgbstats/src/utils.ts` (add normalSF helper)

**Step 1: Understand the problem**

Current implementation uses `1 - normalCDF()` which loses precision for extreme values:

```typescript
// Current (loses precision near 1)
const sf = 1 - normalCDF(0, meanDiff, stdDiff);
```

Python uses `norm.sf()` which is numerically stable.

**Step 2: Add normalSF helper to utils.ts**

In `packages/tsgbstats/src/utils.ts`, add:

```typescript
import normalCDF from "@stdlib/stats-base-dists-normal-cdf";

/**
 * Normal survival function (1 - CDF) with better numerical stability.
 * For values where CDF is close to 1, uses the complementary calculation.
 */
export function normalSF(x: number, mu: number, sigma: number): number {
  // Use the identity SF(x) = CDF(-x) for numerical stability when x > mu
  // This avoids catastrophic cancellation when CDF(x) is close to 1
  const z = (x - mu) / sigma;
  if (z > 0) {
    // When z > 0, CDF(z) is close to 1, use CDF(-z) instead
    return normalCDF(-z, 0, 1);
  } else {
    // When z <= 0, direct calculation is stable
    return 1 - normalCDF(z, 0, 1);
  }
}
```

**Step 3: Update chanceToWin to use normalSF**

In `packages/tsgbstats/src/bayesian/tests.ts`, change:

```typescript
// BEFORE
chanceToWin(meanDiff: number, stdDiff: number): number {
  const sf = 1 - normalCDF(0, meanDiff, stdDiff);
  return this.inverse ? 1 - sf : sf;
}

// AFTER
import { normalSF } from "../utils";

chanceToWin(meanDiff: number, stdDiff: number): number {
  const sf = normalSF(0, meanDiff, stdDiff);
  return this.inverse ? 1 - sf : sf;
}
```

**Step 4: Run compare-stats**

```bash
cd packages/back-end && pnpm compare-stats
```

Expected: `chanceToWin` differences should be reduced (from ~1e-6 to ~1e-10 or smaller).

**Step 5: Run tsgbstats tests to ensure no regressions**

```bash
cd packages/tsgbstats && pnpm test
```

**Step 6: Commit**

```bash
git add packages/tsgbstats/src/utils.ts packages/tsgbstats/src/bayesian/tests.ts
git commit -m "fix(tsgbstats): use numerically stable survival function for chanceToWin

Add normalSF helper that avoids precision loss when CDF is close to 1.
Uses identity SF(x) = CDF(-x) for improved numerical stability.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 4: Improve truncatedNormalMean Precision

**Files:**

- Modify: `packages/tsgbstats/src/utils.ts:79-104`
- Reference: Python `scipy.stats.truncnorm`

**Step 1: Understand the current implementation**

The current `truncatedNormalMean` manually computes phi and Phi, which loses precision in edge cases:

```typescript
const phi = (x: number): number => {
  if (!isFinite(x)) return 0;
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
};
```

**Step 2: Use log-space computation for better precision**

Replace the current implementation with a more numerically stable version:

```typescript
import normalPDF from "@stdlib/stats-base-dists-normal-pdf";

export function truncatedNormalMean(
  mu: number,
  sigma: number,
  a: number,
  b: number,
): number {
  const alpha = (a - mu) / sigma;
  const beta = (b - mu) / sigma;

  // Use stdlib's PDF for better precision
  const phiAlpha = isFinite(alpha) ? normalPDF(alpha, 0, 1) : 0;
  const phiBeta = isFinite(beta) ? normalPDF(beta, 0, 1) : 0;

  // Use survival function identity for numerical stability
  let PhiAlpha: number;
  let PhiBeta: number;

  if (isFinite(alpha)) {
    PhiAlpha = alpha < 0 ? normalCDF(alpha, 0, 1) : 1 - normalCDF(-alpha, 0, 1);
  } else {
    PhiAlpha = alpha < 0 ? 0 : 1;
  }

  if (isFinite(beta)) {
    PhiBeta = beta < 0 ? normalCDF(beta, 0, 1) : 1 - normalCDF(-beta, 0, 1);
  } else {
    PhiBeta = beta < 0 ? 0 : 1;
  }

  const denominator = PhiBeta - PhiAlpha;
  if (denominator === 0) return mu;

  return mu + (sigma * (phiAlpha - phiBeta)) / denominator;
}
```

**Step 3: Add @stdlib/stats-base-dists-normal-pdf dependency**

```bash
cd packages/tsgbstats && pnpm add @stdlib/stats-base-dists-normal-pdf
```

**Step 4: Run compare-stats**

```bash
cd packages/back-end && pnpm compare-stats
```

Expected: `risk` differences should be reduced.

**Step 5: Run tsgbstats tests**

```bash
cd packages/tsgbstats && pnpm test
```

**Step 6: Commit**

```bash
git add packages/tsgbstats/src/utils.ts packages/tsgbstats/package.json pnpm-lock.yaml
git commit -m "fix(tsgbstats): improve truncatedNormalMean numerical precision

Use @stdlib normalPDF and survival function identity for better
precision in edge cases. Reduces risk calculation differences.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 5: Verify Supplemental Results Are Properly Generated

**Files:**

- Review: `packages/tsgbstats/src/supplemental.ts`
- Review: `packages/tsgbstats/src/gbstats.ts:879`
- Debug: Add logging to understand flow

**Step 1: Add debug logging to supplemental.ts**

Temporarily add logging to understand if supplemental analyses are running:

```typescript
export function createCoreAndSupplementalResults(
  reducedMetricData: DimensionMetricData[],
  numVariations: number,
  metric: MetricSettingsForStatsEngine,
  analysis: AnalysisSettingsForStatsEngine,
): DimensionResponse[] {
  console.log("[DEBUG] createCoreAndSupplementalResults called");
  console.log(
    "[DEBUG] cupedAdjusted:",
    metric.statisticType === "ratio_ra" || metric.statisticType === "mean_ra",
  );
  console.log(
    "[DEBUG] analysisBayesian:",
    analysis.statsEngine === "bayesian" && metric.priorProper,
  );
  // ... rest of function
}
```

**Step 2: Run compare-stats with debugging**

```bash
cd packages/back-end && pnpm compare-stats 2>&1 | head -100
```

**Step 3: Identify if supplemental analyses are being run**

Check the debug output to see if:

- `cupedAdjusted` is true for mean_ra metrics
- `analysisBayesian` is true for Bayesian with proper prior
- The supplemental results are being generated

**Step 4: If supplemental not running, investigate the condition checks**

The conditions in `supplemental.ts` should trigger supplemental analyses for:

- `mean_ra` or `ratio_ra` → cupedUnadjusted
- `bayesian` + `priorProper` → flatPrior
- `postStratificationEnabled` → unstratified, noVarianceReduction

**Step 5: Remove debug logging and commit fixes if needed**

---

## Task 6: Adjust Comparison Tolerance or Document Expected Differences

**Files:**

- Review: `packages/back-end/scripts/compare-stats.ts:156`

**Step 1: Assess remaining differences after Tasks 1-5**

Run compare-stats and categorize remaining differences:

- Differences < 1e-10: These are numerical noise, acceptable
- Differences 1e-10 to 1e-8: May be acceptable depending on field
- Differences > 1e-8: Need investigation

**Step 2: Consider adjusting tolerance for specific fields**

If `chanceToWin` and `risk` consistently differ by ~1e-9, these may be inherent library differences. Options:

1. Accept small differences as "close enough"
2. Use field-specific tolerances
3. Continue optimizing algorithms

**Step 3: Update compare-stats.ts if needed**

If we decide some differences are acceptable:

```typescript
// Field-specific tolerances
const TOLERANCES: Record<string, number> = {
  chanceToWin: 1e-6, // Higher tolerance for Bayesian probability
  risk: 1e-6,
  default: 1e-10,
};
```

**Step 4: Document any accepted differences**

Add comments in compare-stats.ts explaining why certain tolerances are acceptable.

---

## Task 7: Final Verification and Cleanup

**Files:**

- Run: All tests in `packages/tsgbstats`
- Run: `pnpm compare-stats` in `packages/back-end`

**Step 1: Run full tsgbstats test suite**

```bash
cd packages/tsgbstats && pnpm test
```

Ensure all tests pass.

**Step 2: Run compare-stats and verify pass**

```bash
cd packages/back-end && pnpm compare-stats
```

Expected: "Stats comparison PASSED" or acceptable difference count.

**Step 3: Remove any debug code added during investigation**

**Step 4: Create summary PR with all changes**

```bash
git add -A
git commit -m "feat(tsgbstats): achieve parity with Python gbstats

- Add businessMetricType to metric settings conversion for power calculation
- Use actual postStratificationApplied from moments result
- Improve numerical stability of chanceToWin using survival function
- Improve truncatedNormalMean precision
- Verify supplemental results generation

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Verification Checklist

After completing all tasks:

- [ ] `pnpm compare-stats` passes or shows only acceptable differences
- [ ] `pnpm test` in `packages/tsgbstats` passes
- [ ] No `power: missing in TS` for goal metrics
- [ ] No `realizedSettings: missing in TS`
- [ ] No `supplementalResults: missing in TS`
- [ ] Numerical differences are < 1e-8 for all fields

---

## Reference: Key Files

| Purpose             | Python                                       | TypeScript                                      |
| ------------------- | -------------------------------------------- | ----------------------------------------------- |
| Main entry          | `packages/stats/gbstats/gbstats.py`          | `packages/tsgbstats/src/gbstats.ts`             |
| Bayesian tests      | `packages/stats/gbstats/bayesian/tests.py`   | `packages/tsgbstats/src/bayesian/tests.ts`      |
| Supplemental        | `packages/stats/gbstats/gbstats.py:862-1032` | `packages/tsgbstats/src/supplemental.ts`        |
| Settings conversion | N/A                                          | `packages/back-end/src/services/statsShadow.ts` |
| Comparison script   | N/A                                          | `packages/back-end/scripts/compare-stats.ts`    |
