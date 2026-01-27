# TypeScript Stats Engine (tsgbstats) Feature Parity Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Achieve full feature parity between the Python `gbstats` and TypeScript `tsgbstats` stats engines to enable shadow testing validation.

**Architecture:** The tsgbstats package mirrors the Python gbstats structure. We'll implement missing features in priority order: (1) supplementalResults for alternative analyses, (2) bandit support, (3) power calculation integration, (4) experiment-level error/banditResult fields. Each feature follows TDD with fixtures generated from Python.

**Tech Stack:** TypeScript, Jest, Python (for fixture generation), @stdlib stats libraries

---

## Phase 1: Supplemental Results Infrastructure

### Task 1: Add SupplementalResults Interface and Types

**Files:**

- Modify: `packages/tsgbstats/src/gbstats.ts:65-92`
- Test: `packages/tsgbstats/test/gbstats.test.ts`

**Step 1: Add SupplementalResults interface**

Add after `RealizedSettings` interface (line 67):

```typescript
export interface SupplementalResults {
  cupedUnadjusted: VariationResponseIndividual | null;
  uncapped: VariationResponseIndividual | null;
  flatPrior: VariationResponseIndividual | null;
  unstratified: VariationResponseIndividual | null;
  noVarianceReduction: VariationResponseIndividual | null;
}

// Individual variation response without supplemental (for nesting)
export interface BayesianVariationResponseIndividual
  extends BaseVariationResponse {
  chanceToWin: number;
  risk: [number, number];
  riskType: "relative" | "absolute";
}

export interface FrequentistVariationResponseIndividual
  extends BaseVariationResponse {
  pValue: number | null;
  pValueErrorMessage?: string | null;
}

export type VariationResponseIndividual =
  | BaselineResponse
  | BayesianVariationResponseIndividual
  | FrequentistVariationResponseIndividual;
```

**Step 2: Update variation response interfaces to include supplementalResults**

Modify `BayesianVariationResponse` and `FrequentistVariationResponse`:

```typescript
export interface BayesianVariationResponse
  extends BayesianVariationResponseIndividual {
  supplementalResults?: SupplementalResults;
}

export interface FrequentistVariationResponse
  extends FrequentistVariationResponseIndividual {
  supplementalResults?: SupplementalResults;
}

export interface BaselineResponseWithSupplementalResults
  extends BaselineResponse {
  supplementalResults?: SupplementalResults;
}
```

**Step 3: Run type-check**

Run: `cd packages/tsgbstats && pnpm run type-check`
Expected: PASS

**Step 4: Commit**

```bash
git add packages/tsgbstats/src/gbstats.ts
git commit -m "feat(tsgbstats): add SupplementalResults interface and types"
```

---

### Task 2: Add getCupedUnadjustedStat Utility Function

**Files:**

- Create: `packages/tsgbstats/src/utils/cupedUnadjusted.ts`
- Test: `packages/tsgbstats/test/utils/cupedUnadjusted.test.ts`

**Step 1: Write the failing test**

Create `packages/tsgbstats/test/utils/cupedUnadjusted.test.ts`:

```typescript
import { getCupedUnadjustedStat } from "../../src/utils/cupedUnadjusted";
import {
  RegressionAdjustedStatistic,
  RegressionAdjustedRatioStatistic,
  SampleMeanStatistic,
  ProportionStatistic,
  RatioStatistic,
} from "../../src/models/statistics";

describe("getCupedUnadjustedStat", () => {
  it("converts RegressionAdjustedStatistic with SampleMean to SampleMeanStatistic", () => {
    const postStatistic = new SampleMeanStatistic({
      n: 100,
      sum: 500,
      sum_squares: 3000,
    });
    const preStatistic = new SampleMeanStatistic({
      n: 100,
      sum: 450,
      sum_squares: 2500,
    });
    const stat = new RegressionAdjustedStatistic({
      n: 100,
      post_statistic: postStatistic,
      pre_statistic: preStatistic,
      post_pre_sum_of_products: 2700,
      theta: null,
    });

    const result = getCupedUnadjustedStat(stat);

    expect(result).toBeInstanceOf(SampleMeanStatistic);
    expect(result.n).toBe(100);
    expect((result as SampleMeanStatistic).sum).toBe(500);
    expect((result as SampleMeanStatistic).sumSquares).toBe(3000);
  });

  it("converts RegressionAdjustedStatistic with Proportion to ProportionStatistic", () => {
    const postStatistic = new ProportionStatistic({
      n: 100,
      sum: 75,
    });
    const preStatistic = new ProportionStatistic({
      n: 100,
      sum: 70,
    });
    const stat = new RegressionAdjustedStatistic({
      n: 100,
      post_statistic: postStatistic,
      pre_statistic: preStatistic,
      post_pre_sum_of_products: 60,
      theta: null,
    });

    const result = getCupedUnadjustedStat(stat);

    expect(result).toBeInstanceOf(ProportionStatistic);
    expect(result.n).toBe(100);
  });

  it("converts RegressionAdjustedRatioStatistic to RatioStatistic", () => {
    const mStatPost = new SampleMeanStatistic({
      n: 100,
      sum: 500,
      sum_squares: 3000,
    });
    const dStatPost = new SampleMeanStatistic({
      n: 100,
      sum: 200,
      sum_squares: 500,
    });
    const mStatPre = new SampleMeanStatistic({
      n: 100,
      sum: 450,
      sum_squares: 2500,
    });
    const dStatPre = new SampleMeanStatistic({
      n: 100,
      sum: 180,
      sum_squares: 400,
    });

    const stat = new RegressionAdjustedRatioStatistic({
      n: 100,
      m_statistic_post: mStatPost,
      d_statistic_post: dStatPost,
      m_statistic_pre: mStatPre,
      d_statistic_pre: dStatPre,
      m_post_m_pre_sum_of_products: 2700,
      d_post_d_pre_sum_of_products: 450,
      m_pre_d_pre_sum_of_products: 1000,
      m_post_d_post_sum_of_products: 1200,
      m_post_d_pre_sum_of_products: 1100,
      m_pre_d_post_sum_of_products: 900,
      theta: null,
    });

    const result = getCupedUnadjustedStat(stat);

    expect(result).toBeInstanceOf(RatioStatistic);
  });

  it("returns same stat if not regression adjusted", () => {
    const stat = new SampleMeanStatistic({
      n: 100,
      sum: 500,
      sum_squares: 3000,
    });
    const result = getCupedUnadjustedStat(stat);
    expect(result).toBe(stat);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/tsgbstats && pnpm test -- test/utils/cupedUnadjusted.test.ts`
Expected: FAIL with "Cannot find module"

**Step 3: Create the implementation**

Create `packages/tsgbstats/src/utils/cupedUnadjusted.ts`:

```typescript
import type { TestStatistic } from "../models/statistics";
import {
  RegressionAdjustedStatistic,
  RegressionAdjustedRatioStatistic,
  SampleMeanStatistic,
  ProportionStatistic,
  RatioStatistic,
} from "../models/statistics";

/**
 * Convert a CUPED-adjusted statistic back to its unadjusted form.
 * Used for generating supplemental results without CUPED adjustment.
 */
export function getCupedUnadjustedStat(stat: TestStatistic): TestStatistic {
  if (stat instanceof RegressionAdjustedStatistic) {
    const postStat = stat.postStatistic;
    if (postStat instanceof SampleMeanStatistic) {
      return new SampleMeanStatistic({
        n: postStat.n,
        sum: postStat.sum,
        sum_squares: postStat.sumSquares,
      });
    } else {
      return new ProportionStatistic({
        n: postStat.n,
        sum: (postStat as ProportionStatistic).sum,
      });
    }
  } else if (stat instanceof RegressionAdjustedRatioStatistic) {
    const mStatPost = stat.mStatisticPost;
    const dStatPost = stat.dStatisticPost;

    let mStatistic: SampleMeanStatistic | ProportionStatistic;
    if (mStatPost instanceof SampleMeanStatistic) {
      mStatistic = new SampleMeanStatistic({
        n: mStatPost.n,
        sum: mStatPost.sum,
        sum_squares: mStatPost.sumSquares,
      });
    } else {
      mStatistic = new ProportionStatistic({
        n: mStatPost.n,
        sum: (mStatPost as ProportionStatistic).sum,
      });
    }

    let dStatistic: SampleMeanStatistic | ProportionStatistic;
    if (dStatPost instanceof SampleMeanStatistic) {
      dStatistic = new SampleMeanStatistic({
        n: dStatPost.n,
        sum: dStatPost.sum,
        sum_squares: dStatPost.sumSquares,
      });
    } else {
      dStatistic = new ProportionStatistic({
        n: dStatPost.n,
        sum: (dStatPost as ProportionStatistic).sum,
      });
    }

    return new RatioStatistic({
      n: stat.n,
      m_statistic: mStatistic,
      d_statistic: dStatistic,
      m_d_sum_of_products: stat.mPostDPostSumOfProducts,
    });
  }

  return stat;
}
```

**Step 4: Run test to verify it passes**

Run: `cd packages/tsgbstats && pnpm test -- test/utils/cupedUnadjusted.test.ts`
Expected: PASS

**Step 5: Export from index.ts**

Add to `packages/tsgbstats/src/index.ts`:

```typescript
export { getCupedUnadjustedStat } from "./utils/cupedUnadjusted";
```

**Step 6: Commit**

```bash
git add packages/tsgbstats/src/utils/cupedUnadjusted.ts packages/tsgbstats/test/utils/cupedUnadjusted.test.ts packages/tsgbstats/src/index.ts
git commit -m "feat(tsgbstats): add getCupedUnadjustedStat utility function"
```

---

### Task 3: Add testPostStratEligible Function

**Files:**

- Create: `packages/tsgbstats/src/utils/postStratEligible.ts`
- Test: `packages/tsgbstats/test/utils/postStratEligible.test.ts`

**Step 1: Write the failing test**

Create `packages/tsgbstats/test/utils/postStratEligible.test.ts`:

```typescript
import { testPostStratEligible } from "../../src/utils/postStratEligible";
import type {
  MetricSettingsForStatsEngine,
  AnalysisSettingsForStatsEngine,
} from "../../src/models/settings";
import {
  DEFAULT_METRIC_SETTINGS,
  DEFAULT_ANALYSIS_SETTINGS,
} from "../../src/models/settings";

describe("testPostStratEligible", () => {
  it("returns true when post-stratification is enabled and statistic is eligible", () => {
    const metric: MetricSettingsForStatsEngine = {
      ...DEFAULT_METRIC_SETTINGS,
      statisticType: "mean",
    };
    const analysis: AnalysisSettingsForStatsEngine = {
      ...DEFAULT_ANALYSIS_SETTINGS,
      postStratificationEnabled: true,
    };

    expect(testPostStratEligible(metric, analysis)).toBe(true);
  });

  it("returns false when post-stratification is disabled", () => {
    const metric: MetricSettingsForStatsEngine = {
      ...DEFAULT_METRIC_SETTINGS,
      statisticType: "mean",
    };
    const analysis: AnalysisSettingsForStatsEngine = {
      ...DEFAULT_ANALYSIS_SETTINGS,
      postStratificationEnabled: false,
    };

    expect(testPostStratEligible(metric, analysis)).toBe(false);
  });

  it("returns false for quantile_unit statistic type", () => {
    const metric: MetricSettingsForStatsEngine = {
      ...DEFAULT_METRIC_SETTINGS,
      statisticType: "quantile_unit",
    };
    const analysis: AnalysisSettingsForStatsEngine = {
      ...DEFAULT_ANALYSIS_SETTINGS,
      postStratificationEnabled: true,
    };

    expect(testPostStratEligible(metric, analysis)).toBe(false);
  });

  it("returns false for quantile_event statistic type", () => {
    const metric: MetricSettingsForStatsEngine = {
      ...DEFAULT_METRIC_SETTINGS,
      statisticType: "quantile_event",
    };
    const analysis: AnalysisSettingsForStatsEngine = {
      ...DEFAULT_ANALYSIS_SETTINGS,
      postStratificationEnabled: true,
    };

    expect(testPostStratEligible(metric, analysis)).toBe(false);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/tsgbstats && pnpm test -- test/utils/postStratEligible.test.ts`
Expected: FAIL

**Step 3: Create the implementation**

Create `packages/tsgbstats/src/utils/postStratEligible.ts`:

```typescript
import type {
  MetricSettingsForStatsEngine,
  AnalysisSettingsForStatsEngine,
} from "../models/settings";

/**
 * Check if post-stratification can be applied to this metric/analysis combination.
 */
export function testPostStratEligible(
  metric: MetricSettingsForStatsEngine,
  analysis: AnalysisSettingsForStatsEngine,
): boolean {
  if (!analysis.postStratificationEnabled) {
    return false;
  }

  // Quantile metrics are not eligible for post-stratification
  if (
    metric.statisticType === "quantile_unit" ||
    metric.statisticType === "quantile_event"
  ) {
    return false;
  }

  return true;
}
```

**Step 4: Run test to verify it passes**

Run: `cd packages/tsgbstats && pnpm test -- test/utils/postStratEligible.test.ts`
Expected: PASS

**Step 5: Export from index.ts**

Add to `packages/tsgbstats/src/index.ts`:

```typescript
export { testPostStratEligible } from "./utils/postStratEligible";
```

**Step 6: Commit**

```bash
git add packages/tsgbstats/src/utils/postStratEligible.ts packages/tsgbstats/test/utils/postStratEligible.test.ts packages/tsgbstats/src/index.ts
git commit -m "feat(tsgbstats): add testPostStratEligible utility function"
```

---

### Task 4: Add replaceWithUncapped Function

**Files:**

- Create: `packages/tsgbstats/src/utils/uncapped.ts`
- Test: `packages/tsgbstats/test/utils/uncapped.test.ts`

**Step 1: Write the failing test**

Create `packages/tsgbstats/test/utils/uncapped.test.ts`:

```typescript
import { replaceWithUncapped } from "../../src/utils/uncapped";

describe("replaceWithUncapped", () => {
  it("replaces main columns with uncapped versions", () => {
    const data = [
      {
        dimension: "",
        baseline_main_sum: 100,
        baseline_main_sum_squares: 1000,
        baseline_uncapped_main_sum: 150,
        baseline_uncapped_main_sum_squares: 2000,
        baseline_users: 50,
        v1_main_sum: 120,
        v1_main_sum_squares: 1200,
        v1_uncapped_main_sum: 180,
        v1_uncapped_main_sum_squares: 2400,
        v1_users: 55,
      },
    ];

    const result = replaceWithUncapped(data);

    expect(result[0].baseline_main_sum).toBe(150);
    expect(result[0].baseline_main_sum_squares).toBe(2000);
    expect(result[0].v1_main_sum).toBe(180);
    expect(result[0].v1_main_sum_squares).toBe(2400);
  });

  it("does not modify data if uncapped columns are missing", () => {
    const data = [
      {
        dimension: "",
        baseline_main_sum: 100,
        baseline_main_sum_squares: 1000,
        baseline_users: 50,
      },
    ];

    const result = replaceWithUncapped(data);

    expect(result[0].baseline_main_sum).toBe(100);
    expect(result[0].baseline_main_sum_squares).toBe(1000);
  });

  it("returns deep copy of data", () => {
    const data = [{ baseline_main_sum: 100 }];
    const result = replaceWithUncapped(data);

    result[0].baseline_main_sum = 999;
    expect(data[0].baseline_main_sum).toBe(100);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/tsgbstats && pnpm test -- test/utils/uncapped.test.ts`
Expected: FAIL

**Step 3: Create the implementation**

Create `packages/tsgbstats/src/utils/uncapped.ts`:

```typescript
/**
 * Replace main metric columns with their uncapped versions.
 * Used for generating supplemental results with uncapped data.
 */
export function replaceWithUncapped(
  data: Record<string, unknown>[],
): Record<string, unknown>[] {
  // Deep copy the data
  const result = JSON.parse(JSON.stringify(data)) as Record<string, unknown>[];

  // Columns to replace
  const columnsToReplace = ["main_sum", "main_sum_squares"];

  for (const row of result) {
    for (const key of Object.keys(row)) {
      for (const col of columnsToReplace) {
        // Match patterns like "baseline_main_sum" or "v1_main_sum"
        if (key.endsWith(`_${col}`)) {
          const prefix = key.slice(0, -col.length - 1);
          const uncappedKey = `${prefix}_uncapped_${col}`;

          if (uncappedKey in row && row[uncappedKey] !== undefined) {
            row[key] = row[uncappedKey];
          }
        }
      }
    }
  }

  return result;
}
```

**Step 4: Run test to verify it passes**

Run: `cd packages/tsgbstats && pnpm test -- test/utils/uncapped.test.ts`
Expected: PASS

**Step 5: Export from index.ts**

Add to `packages/tsgbstats/src/index.ts`:

```typescript
export { replaceWithUncapped } from "./utils/uncapped";
```

**Step 6: Commit**

```bash
git add packages/tsgbstats/src/utils/uncapped.ts packages/tsgbstats/test/utils/uncapped.test.ts packages/tsgbstats/src/index.ts
git commit -m "feat(tsgbstats): add replaceWithUncapped utility function"
```

---

### Task 5: Add createCoreAndSupplementalResults Function

**Files:**

- Create: `packages/tsgbstats/src/supplemental.ts`
- Test: `packages/tsgbstats/test/supplemental.test.ts`
- Modify: `packages/tsgbstats/src/gbstats.ts`

**Step 1: Write the failing test**

Create `packages/tsgbstats/test/supplemental.test.ts`:

```typescript
import { createCoreAndSupplementalResults } from "../src/supplemental";
import type {
  MetricSettingsForStatsEngine,
  AnalysisSettingsForStatsEngine,
} from "../src/models/settings";
import {
  DEFAULT_METRIC_SETTINGS,
  DEFAULT_ANALYSIS_SETTINGS,
} from "../src/models/settings";
import type { DimensionMetricData } from "../src/gbstats";

describe("createCoreAndSupplementalResults", () => {
  const mockMetricData: DimensionMetricData[] = [
    {
      dimension: "",
      totalUnits: 1000,
      data: [
        {
          dimension: "",
          strata: "",
          baseline_id: "0",
          baseline_name: "Control",
          baseline_users: 500,
          baseline_count: 500,
          baseline_main_sum: 250,
          baseline_main_sum_squares: 150,
          v1_id: "1",
          v1_name: "Treatment",
          v1_users: 500,
          v1_count: 500,
          v1_main_sum: 280,
          v1_main_sum_squares: 170,
        },
      ],
    },
  ];

  it("returns core result when no supplemental calculations needed", () => {
    const metric: MetricSettingsForStatsEngine = {
      ...DEFAULT_METRIC_SETTINGS,
      statisticType: "mean",
      priorProper: false,
    };
    const analysis: AnalysisSettingsForStatsEngine = {
      ...DEFAULT_ANALYSIS_SETTINGS,
      varIds: ["0", "1"],
      varNames: ["Control", "Treatment"],
      statsEngine: "frequentist",
      postStratificationEnabled: false,
    };

    const result = createCoreAndSupplementalResults(
      mockMetricData,
      2,
      metric,
      analysis,
    );

    expect(result).toHaveLength(1);
    expect(result[0].variations).toHaveLength(2);
    // No supplemental results for basic frequentist
    expect(result[0].variations[1]).not.toHaveProperty("supplementalResults");
  });

  it("generates flatPrior supplemental for Bayesian with proper prior", () => {
    const metric: MetricSettingsForStatsEngine = {
      ...DEFAULT_METRIC_SETTINGS,
      statisticType: "mean",
      priorProper: true,
      priorMean: 0,
      priorStddev: 0.5,
    };
    const analysis: AnalysisSettingsForStatsEngine = {
      ...DEFAULT_ANALYSIS_SETTINGS,
      varIds: ["0", "1"],
      varNames: ["Control", "Treatment"],
      statsEngine: "bayesian",
      postStratificationEnabled: false,
    };

    const result = createCoreAndSupplementalResults(
      mockMetricData,
      2,
      metric,
      analysis,
    );

    expect(result[0].variations[1]).toHaveProperty("supplementalResults");
    const supplemental = (result[0].variations[1] as any).supplementalResults;
    expect(supplemental.flatPrior).not.toBeNull();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/tsgbstats && pnpm test -- test/supplemental.test.ts`
Expected: FAIL

**Step 3: Create the implementation**

Create `packages/tsgbstats/src/supplemental.ts`:

```typescript
import type {
  MetricSettingsForStatsEngine,
  AnalysisSettingsForStatsEngine,
} from "./models/settings";
import type {
  DimensionMetricData,
  DimensionResponse,
  SupplementalResults,
  VariationResponse,
  BayesianVariationResponse,
  FrequentistVariationResponse,
  BaselineResponseWithSupplementalResults,
  BayesianVariationResponseIndividual,
  FrequentistVariationResponseIndividual,
  BaselineResponse,
} from "./gbstats";
import { analyzeMetricDf } from "./gbstats";
import { testPostStratEligible } from "./utils/postStratEligible";
import { replaceWithUncapped } from "./utils/uncapped";

interface DimensionResponseIndividual {
  dimension: string;
  srm: number;
  variations: (
    | BaselineResponse
    | BayesianVariationResponseIndividual
    | FrequentistVariationResponseIndividual
  )[];
}

/**
 * Create core analysis results along with supplemental alternative analyses.
 * Mirrors Python's create_core_and_supplemental_results function.
 */
export function createCoreAndSupplementalResults(
  reducedMetricData: DimensionMetricData[],
  numVariations: number,
  metric: MetricSettingsForStatsEngine,
  analysis: AnalysisSettingsForStatsEngine,
): DimensionResponse[] {
  // Run the core analysis
  const coreResult = analyzeMetricDf(
    reducedMetricData,
    numVariations,
    metric,
    analysis,
  ) as DimensionResponseIndividual[];

  // Determine which supplemental analyses to run
  const cupedAdjusted =
    metric.statisticType === "ratio_ra" || metric.statisticType === "mean_ra";
  const computeUncapped = (metric as any).computeUncappedMetric ?? false;
  const analysisBayesian =
    analysis.statsEngine === "bayesian" && metric.priorProper;
  const postStratify = testPostStratEligible(metric, analysis);

  let resultCupedUnadjusted: DimensionResponseIndividual[] | null = null;
  let resultUncapped: DimensionResponseIndividual[] | null = null;
  let resultFlatPrior: DimensionResponseIndividual[] | null = null;
  let resultUnstratified: DimensionResponseIndividual[] | null = null;
  let resultNoVarianceReduction: DimensionResponseIndividual[] | null = null;

  // CUPED unadjusted (for mean_ra and ratio_ra)
  if (cupedAdjusted) {
    const metricCupedUnadjusted: MetricSettingsForStatsEngine = {
      ...metric,
      statisticType: metric.statisticType === "mean_ra" ? "mean" : "ratio",
    };
    resultCupedUnadjusted = analyzeMetricDf(
      reducedMetricData,
      numVariations,
      metricCupedUnadjusted,
      analysis,
    ) as DimensionResponseIndividual[];

    if (postStratify) {
      const analysisUnstratified: AnalysisSettingsForStatsEngine = {
        ...analysis,
        postStratificationEnabled: false,
      };
      resultUnstratified = analyzeMetricDf(
        reducedMetricData,
        numVariations,
        metric,
        analysisUnstratified,
      ) as DimensionResponseIndividual[];
      resultNoVarianceReduction = analyzeMetricDf(
        reducedMetricData,
        numVariations,
        metricCupedUnadjusted,
        analysisUnstratified,
      ) as DimensionResponseIndividual[];
    }
  } else if (postStratify) {
    const analysisUnstratified: AnalysisSettingsForStatsEngine = {
      ...analysis,
      postStratificationEnabled: false,
    };
    resultUnstratified = analyzeMetricDf(
      reducedMetricData,
      numVariations,
      metric,
      analysisUnstratified,
    ) as DimensionResponseIndividual[];
  }

  // Uncapped (if metric has uncapped columns)
  if (computeUncapped) {
    const uncappedMetricData: DimensionMetricData[] = reducedMetricData.map(
      (d) => ({
        ...d,
        data: replaceWithUncapped(d.data),
      }),
    );
    resultUncapped = analyzeMetricDf(
      uncappedMetricData,
      numVariations,
      metric,
      analysis,
    ) as DimensionResponseIndividual[];
  }

  // Flat prior (for Bayesian with proper prior)
  if (analysisBayesian) {
    const metricFlatPrior: MetricSettingsForStatsEngine = {
      ...metric,
      priorProper: false,
    };
    resultFlatPrior = analyzeMetricDf(
      reducedMetricData,
      numVariations,
      metricFlatPrior,
      analysis,
    ) as DimensionResponseIndividual[];
  }

  // Combine core and supplemental results
  return combineResults(
    coreResult,
    resultCupedUnadjusted,
    resultUncapped,
    resultFlatPrior,
    resultUnstratified,
    resultNoVarianceReduction,
  );
}

function combineResults(
  coreResult: DimensionResponseIndividual[],
  resultCupedUnadjusted: DimensionResponseIndividual[] | null,
  resultUncapped: DimensionResponseIndividual[] | null,
  resultFlatPrior: DimensionResponseIndividual[] | null,
  resultUnstratified: DimensionResponseIndividual[] | null,
  resultNoVarianceReduction: DimensionResponseIndividual[] | null,
): DimensionResponse[] {
  const supplementalMappings: Array<
    [DimensionResponseIndividual[] | null, keyof SupplementalResults]
  > = [
    [resultCupedUnadjusted, "cupedUnadjusted"],
    [resultUncapped, "uncapped"],
    [resultFlatPrior, "flatPrior"],
    [resultUnstratified, "unstratified"],
    [resultNoVarianceReduction, "noVarianceReduction"],
  ];

  const result: DimensionResponse[] = [];

  for (let dimI = 0; dimI < coreResult.length; dimI++) {
    const dimResult = coreResult[dimI];
    const variations: VariationResponse[] = [];

    for (let varI = 0; varI < dimResult.variations.length; varI++) {
      const variation = dimResult.variations[varI];
      const isBayesian = "chanceToWin" in variation;
      const isFrequentist = "pValue" in variation;
      const isBaseline = !isBayesian && !isFrequentist;

      // Create supplemental results object
      const supplementalResults: SupplementalResults = {
        cupedUnadjusted: null,
        uncapped: null,
        flatPrior: null,
        unstratified: null,
        noVarianceReduction: null,
      };

      // Set supplemental results if available
      for (const [supplementalResult, attributeName] of supplementalMappings) {
        if (
          supplementalResult !== null &&
          supplementalResult.length > dimI &&
          supplementalResult[dimI].variations.length > varI &&
          supplementalResult[dimI].variations[varI] !== null
        ) {
          supplementalResults[attributeName] =
            supplementalResult[dimI].variations[varI];
        }
      }

      // Create the variation response with supplemental
      let variationResponse: VariationResponse;
      if (isBayesian) {
        variationResponse = {
          ...variation,
          supplementalResults,
        } as BayesianVariationResponse;
      } else if (isFrequentist) {
        variationResponse = {
          ...variation,
          supplementalResults,
        } as FrequentistVariationResponse;
      } else {
        variationResponse = {
          ...variation,
          supplementalResults,
        } as BaselineResponseWithSupplementalResults;
      }

      variations.push(variationResponse);
    }

    result.push({
      dimension: dimResult.dimension,
      srm: dimResult.srm,
      variations,
    });
  }

  return result;
}
```

**Step 4: Run test to verify it passes**

Run: `cd packages/tsgbstats && pnpm test -- test/supplemental.test.ts`
Expected: PASS

**Step 5: Export from index.ts**

Add to `packages/tsgbstats/src/index.ts`:

```typescript
export { createCoreAndSupplementalResults } from "./supplemental";
```

**Step 6: Commit**

```bash
git add packages/tsgbstats/src/supplemental.ts packages/tsgbstats/test/supplemental.test.ts packages/tsgbstats/src/index.ts
git commit -m "feat(tsgbstats): add createCoreAndSupplementalResults function"
```

---

### Task 6: Integrate Supplemental Results into processAnalysis

**Files:**

- Modify: `packages/tsgbstats/src/gbstats.ts:720-760`
- Test: Update `packages/tsgbstats/test/gbstats.test.ts`

**Step 1: Update processAnalysis to use supplemental results**

Modify `packages/tsgbstats/src/gbstats.ts` - replace `processAnalysis` function:

```typescript
export function processAnalysis(
  rows: Record<string, unknown>[],
  varIdMap: VarIdMap,
  metric: MetricSettingsForStatsEngine,
  analysis: AnalysisSettingsForStatsEngine,
): DimensionResponse[] {
  const varNames = analysis.varNames;
  const maxDimensions = analysis.maxDimensions;

  // Convert raw SQL result into dimension-grouped data
  const metricData = getMetricDfs(
    rows,
    varIdMap,
    varNames,
    analysis.dimension,
    analysis.postStratificationEnabled ?? false,
  );

  // Determine if we keep the "(other)" dimension
  let keepOther = true;
  if (
    metric.statisticType === "quantile_event" ||
    metric.statisticType === "quantile_unit"
  ) {
    keepOther = false;
  }
  if (metric.keepTheta && metric.statisticType === "mean_ra") {
    keepOther = false;
  }

  // Reduce dimensionality
  const reducedMetricData = reduceDimensionality(
    metricData,
    varNames.length,
    maxDimensions,
    keepOther,
    !(analysis.postStratificationEnabled ?? false),
  );

  // Run the analysis with supplemental results
  return createCoreAndSupplementalResults(
    reducedMetricData,
    varNames.length,
    metric,
    analysis,
  );
}
```

**Step 2: Add import for createCoreAndSupplementalResults**

Add at top of `gbstats.ts`:

```typescript
import { createCoreAndSupplementalResults } from "./supplemental";
```

**Step 3: Run full test suite**

Run: `cd packages/tsgbstats && pnpm test`
Expected: PASS

**Step 4: Commit**

```bash
git add packages/tsgbstats/src/gbstats.ts
git commit -m "feat(tsgbstats): integrate supplemental results into processAnalysis"
```

---

## Phase 2: Power Calculation Integration

### Task 7: Add decisionMakingConditions Function

**Files:**

- Create: `packages/tsgbstats/src/utils/decisionMaking.ts`
- Test: `packages/tsgbstats/test/utils/decisionMaking.test.ts`

**Step 1: Write the failing test**

Create `packages/tsgbstats/test/utils/decisionMaking.test.ts`:

```typescript
import { decisionMakingConditions } from "../../src/utils/decisionMaking";
import {
  DEFAULT_METRIC_SETTINGS,
  DEFAULT_ANALYSIS_SETTINGS,
} from "../../src/models/settings";

describe("decisionMakingConditions", () => {
  it("returns true for goal metric with relative difference and no dimension", () => {
    const metric = {
      ...DEFAULT_METRIC_SETTINGS,
      businessMetricType: "goal",
    };
    const analysis = {
      ...DEFAULT_ANALYSIS_SETTINGS,
      differenceType: "relative" as const,
      dimension: "",
    };

    expect(decisionMakingConditions(metric, analysis)).toBe(true);
  });

  it("returns false when businessMetricType is missing", () => {
    const metric = {
      ...DEFAULT_METRIC_SETTINGS,
      businessMetricType: undefined,
    };
    const analysis = {
      ...DEFAULT_ANALYSIS_SETTINGS,
      differenceType: "relative" as const,
      dimension: "",
    };

    expect(decisionMakingConditions(metric, analysis)).toBe(false);
  });

  it("returns false for guardrail metric", () => {
    const metric = {
      ...DEFAULT_METRIC_SETTINGS,
      businessMetricType: "guardrail",
    };
    const analysis = {
      ...DEFAULT_ANALYSIS_SETTINGS,
      differenceType: "relative" as const,
      dimension: "",
    };

    expect(decisionMakingConditions(metric, analysis)).toBe(false);
  });

  it("returns false for absolute difference type", () => {
    const metric = {
      ...DEFAULT_METRIC_SETTINGS,
      businessMetricType: "goal",
    };
    const analysis = {
      ...DEFAULT_ANALYSIS_SETTINGS,
      differenceType: "absolute" as const,
      dimension: "",
    };

    expect(decisionMakingConditions(metric, analysis)).toBe(false);
  });

  it("returns false when dimension is set", () => {
    const metric = {
      ...DEFAULT_METRIC_SETTINGS,
      businessMetricType: "goal",
    };
    const analysis = {
      ...DEFAULT_ANALYSIS_SETTINGS,
      differenceType: "relative" as const,
      dimension: "country",
    };

    expect(decisionMakingConditions(metric, analysis)).toBe(false);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/tsgbstats && pnpm test -- test/utils/decisionMaking.test.ts`
Expected: FAIL

**Step 3: Create the implementation**

Create `packages/tsgbstats/src/utils/decisionMaking.ts`:

```typescript
import type {
  MetricSettingsForStatsEngine,
  AnalysisSettingsForStatsEngine,
} from "../models/settings";

/**
 * Check if this metric/analysis combination qualifies for power calculation.
 * Power is only calculated for goal metrics with relative difference in overall analysis.
 */
export function decisionMakingConditions(
  metric: MetricSettingsForStatsEngine,
  analysis: AnalysisSettingsForStatsEngine,
): boolean {
  const businessMetricType = (metric as any).businessMetricType;

  return (
    !!businessMetricType &&
    businessMetricType.includes("goal") &&
    analysis.differenceType === "relative" &&
    analysis.dimension === ""
  );
}
```

**Step 4: Run test to verify it passes**

Run: `cd packages/tsgbstats && pnpm test -- test/utils/decisionMaking.test.ts`
Expected: PASS

**Step 5: Add businessMetricType to MetricSettingsForStatsEngine**

Update `packages/tsgbstats/src/models/settings.ts` to add the optional field:

```typescript
export interface MetricSettingsForStatsEngine {
  // ... existing fields ...
  businessMetricType?: string;
  targetMde?: number;
}
```

**Step 6: Export from index.ts**

Add to `packages/tsgbstats/src/index.ts`:

```typescript
export { decisionMakingConditions } from "./utils/decisionMaking";
```

**Step 7: Commit**

```bash
git add packages/tsgbstats/src/utils/decisionMaking.ts packages/tsgbstats/test/utils/decisionMaking.test.ts packages/tsgbstats/src/models/settings.ts packages/tsgbstats/src/index.ts
git commit -m "feat(tsgbstats): add decisionMakingConditions function"
```

---

### Task 8: Integrate Power Calculation into analyzeMetricDf

**Files:**

- Modify: `packages/tsgbstats/src/gbstats.ts:589-715`
- Test: `packages/tsgbstats/test/gbstats.test.ts`

**Step 1: Add runMidExperimentPower function**

Add to `packages/tsgbstats/src/gbstats.ts` before `analyzeMetricDf`:

```typescript
import {
  MidExperimentPower,
  MidExperimentPowerConfig,
  MidExperimentPowerResult,
} from "./power/midexperimentpower";
import { decisionMakingConditions } from "./utils/decisionMaking";

export interface PowerResponse {
  status: string;
  errorMessage: string | null;
  firstPeriodPairwiseSampleSize: number;
  targetMDE: number | null;
  sigmahat2Delta: number;
  priorProper: boolean | null;
  priorLiftMean: number | null;
  priorLiftVariance: number | null;
  upperBoundAchieved: boolean | null;
  scalingFactor: number | null;
}

function runMidExperimentPower(
  totalUsers: number,
  numVariations: number,
  effectMoments: EffectMomentsResult,
  res: BayesianTestResult | FrequentistTestResult,
  metric: MetricSettingsForStatsEngine,
  analysis: AnalysisSettingsForStatsEngine,
): PowerResponse {
  const isBayesian = "chanceToWin" in res;

  const prior: GaussianPrior | null = isBayesian
    ? {
        mean: metric.priorMean ?? 0,
        variance: Math.pow(metric.priorStddev ?? 0.5, 2),
        proper: metric.priorProper ?? false,
      }
    : null;

  const powerConfig: MidExperimentPowerConfig = {
    targetPower: 0.8,
    targetMde: metric.targetMde ?? 0.05,
    numGoalMetrics: analysis.numGoalMetrics,
    numVariations: numVariations,
    priorEffect: prior,
    pValueCorrected: analysis.pValueCorrected,
    sequential: analysis.sequentialTestingEnabled,
    sequentialTuningParameter: analysis.sequentialTuningParameter,
  };

  const midExperimentPower = new MidExperimentPower(
    effectMoments,
    res,
    { alpha: analysis.alpha ?? 0.05 },
    powerConfig,
  );

  const powerResult = midExperimentPower.calculateScalingFactor();

  return {
    status: powerResult.error ? "error" : "success",
    errorMessage: powerResult.error ?? null,
    firstPeriodPairwiseSampleSize: effectMoments.pairwiseSampleSize,
    targetMDE: metric.targetMde ?? null,
    sigmahat2Delta: effectMoments.standardError * effectMoments.standardError,
    priorProper: prior?.proper ?? null,
    priorLiftMean: prior?.mean ?? null,
    priorLiftVariance: prior?.variance ?? null,
    upperBoundAchieved: powerResult.upperBoundAchieved ?? null,
    scalingFactor: powerResult.scalingFactor,
  };
}
```

**Step 2: Update analyzeDimension to calculate power**

Modify the `analyzeDimension` inner function in `analyzeMetricDf` to compute power when conditions are met. Update the `BaseVariationResponse` to use the calculated power instead of hardcoded `null`.

**Step 3: Update power type in BaseVariationResponse**

Change the `power` field type from `null` to `PowerResponse | null`:

```typescript
export interface BaseVariationResponse extends BaselineResponse {
  expected: number;
  uplift: Uplift;
  ci: ResponseCI;
  errorMessage: string | null;
  power: PowerResponse | null;
  realizedSettings: RealizedSettings;
}
```

**Step 4: Run tests**

Run: `cd packages/tsgbstats && pnpm test`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/tsgbstats/src/gbstats.ts
git commit -m "feat(tsgbstats): integrate power calculation into analyzeMetricDf"
```

---

## Phase 3: Experiment-Level Fields

### Task 9: Add banditResult and error fields to Result Types

**Files:**

- Modify: `packages/tsgbstats/src/gbstats.ts`
- Modify: `packages/back-end/src/services/statsShadow.ts`

**Step 1: Update ExperimentMetricAnalysis return type**

The shadow service already handles `error` and `traceback` at the experiment level. Update the TypeScript return structure to explicitly include `banditResult: null` to match Python's structure:

Modify `packages/back-end/src/services/statsShadow.ts` `runTsStatsEngine` function:

```typescript
function runTsStatsEngine(
  experiments: ExperimentDataForStatsEngine[],
): MultipleExperimentMetricAnalysis[] {
  return experiments.map((exp) => {
    try {
      const results = runTsStatsForExperiment(exp.data);
      return {
        id: exp.id,
        results:
          results as unknown as MultipleExperimentMetricAnalysis["results"],
        banditResult: null, // Add this line
        error: null,
        traceback: null,
      };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      return {
        id: exp.id,
        results: [] as MultipleExperimentMetricAnalysis["results"],
        banditResult: null, // Add this line
        error: err.message,
        traceback: err.stack,
      };
    }
  });
}
```

**Step 2: Run type-check**

Run: `cd packages/back-end && pnpm run type-check`
Expected: PASS

**Step 3: Commit**

```bash
git add packages/back-end/src/services/statsShadow.ts
git commit -m "feat(statsShadow): add banditResult field to experiment results"
```

---

## Phase 4: Testing and Validation

### Task 10: Generate Updated Fixtures from Python

**Files:**

- Run: `packages/tsgbstats/scripts/generate-fixtures.py`
- Update: All fixture files in `packages/tsgbstats/test/fixtures/`

**Step 1: Update fixture generation script to include supplemental results**

The existing `generate-fixtures.py` script should be updated to generate fixtures that include supplemental results. Run:

```bash
cd packages/tsgbstats && pnpm run fixtures:generate
```

**Step 2: Verify fixtures include new fields**

Check that the generated fixtures include `supplementalResults`, `power`, and other new fields.

**Step 3: Run full test suite**

Run: `cd packages/tsgbstats && pnpm test`
Expected: All tests PASS

**Step 4: Commit**

```bash
git add packages/tsgbstats/test/fixtures/
git commit -m "test(tsgbstats): update fixtures with supplemental results"
```

---

### Task 11: Update Shadow Comparison to Handle Known Differences

**Files:**

- Modify: `packages/back-end/src/services/statsShadow.ts`

**Step 1: Add epsilon-based float comparison**

For shadow testing validation, update `compareResults` to use epsilon-based comparison for floating-point numbers:

```typescript
function normalizeForComparison(obj: unknown): unknown {
  if (obj === null || obj === undefined) {
    return obj;
  }
  if (typeof obj === "number") {
    // Round to 10 decimal places to handle floating point differences
    return Math.round(obj * 1e10) / 1e10;
  }
  if (Array.isArray(obj)) {
    return obj.map(normalizeForComparison);
  }
  if (typeof obj === "object") {
    const result: Record<string, unknown> = {};
    const sorted = Object.keys(obj as Record<string, unknown>).sort();
    for (const key of sorted) {
      result[key] = normalizeForComparison(
        (obj as Record<string, unknown>)[key],
      );
    }
    return result;
  }
  return obj;
}

function compareResults(
  pythonResult: MultipleExperimentMetricAnalysis[],
  tsResult: MultipleExperimentMetricAnalysis[],
): ComparisonResult {
  const normalizedPython = normalizeForComparison(pythonResult);
  const normalizedTs = normalizeForComparison(tsResult);

  const pythonJson = JSON.stringify(normalizedPython);
  const tsJson = JSON.stringify(normalizedTs);

  if (pythonJson === tsJson) {
    return { status: "match" };
  }

  return {
    status: "mismatch",
    diff: {
      summary: `JSON strings differ (Python: ${pythonJson.length} chars, TS: ${tsJson.length} chars)`,
      pythonJson: JSON.stringify(pythonResult),
      tsJson: JSON.stringify(tsResult),
    },
  };
}
```

**Step 2: Run type-check**

Run: `cd packages/back-end && pnpm run type-check`
Expected: PASS

**Step 3: Commit**

```bash
git add packages/back-end/src/services/statsShadow.ts
git commit -m "feat(statsShadow): add epsilon-based float comparison"
```

---

## Phase 5: Bandit Support (Future)

### Task 12: Port Bandit Classes (Placeholder)

**Note:** Bandit support is a larger feature that requires:

1. `BanditsSimple` class
2. `BanditsRatio` class
3. `BanditsCuped` class
4. Thompson sampling implementation
5. Integration with the main processing flow

This task is deferred to a future iteration as it's not blocking shadow testing for non-bandit experiments.

**Files to create:**

- `packages/tsgbstats/src/bayesian/bandits.ts`
- `packages/tsgbstats/test/bayesian/bandits.test.ts`

---

## Summary

| Phase | Task | Description                          | Status   |
| ----- | ---- | ------------------------------------ | -------- |
| 1     | 1    | Add SupplementalResults interface    | Pending  |
| 1     | 2    | Add getCupedUnadjustedStat utility   | Pending  |
| 1     | 3    | Add testPostStratEligible function   | Pending  |
| 1     | 4    | Add replaceWithUncapped function     | Pending  |
| 1     | 5    | Add createCoreAndSupplementalResults | Pending  |
| 1     | 6    | Integrate into processAnalysis       | Pending  |
| 2     | 7    | Add decisionMakingConditions         | Pending  |
| 2     | 8    | Integrate power calculation          | Pending  |
| 3     | 9    | Add banditResult/error fields        | Pending  |
| 4     | 10   | Generate updated fixtures            | Pending  |
| 4     | 11   | Update shadow comparison             | Pending  |
| 5     | 12   | Port bandit classes (future)         | Deferred |

**Estimated effort:** Tasks 1-11 are straightforward ports (~2-3 hours total). Task 12 (bandits) is a larger feature (~4-6 hours).
