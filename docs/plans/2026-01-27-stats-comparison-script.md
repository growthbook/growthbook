# Stats Comparison Script Design

## Overview

A TypeScript script to compare Python gbstats and TypeScript tsgbstats outputs for the same input, validating feature parity during the migration.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                  compare-stats.ts                           │
├─────────────────────────────────────────────────────────────┤
│  1. Load fixture.json                                       │
│                    │                                        │
│         ┌─────────┴─────────┐                               │
│         ▼                   ▼                               │
│  ┌─────────────┐    ┌─────────────┐                         │
│  │ Python      │    │ TypeScript  │                         │
│  │ gbstats     │    │ tsgbstats   │                         │
│  │ (subprocess)│    │ (direct)    │                         │
│  └─────────────┘    └─────────────┘                         │
│         │                   │                               │
│         └─────────┬─────────┘                               │
│                   ▼                                         │
│            Compare results                                  │
│            (normalize + JSON compare)                       │
│                   │                                         │
│         ┌────────┴────────┐                                 │
│         ▼                 ▼                                 │
│     Match              Mismatch                             │
│     exit(0)            print diff + exit(1)                 │
└─────────────────────────────────────────────────────────────┘
```

## Files

| File                                                            | Purpose                                            |
| --------------------------------------------------------------- | -------------------------------------------------- |
| `packages/back-end/scripts/compare-stats.ts`                    | Main comparison script                             |
| `packages/back-end/test/fixtures/stats-comparison-fixture.json` | Test fixture (ExperimentDataForStatsEngine format) |
| `packages/back-end/src/services/statsShadow.ts`                 | Refactored to export reusable functions            |

## Code Reuse

Extract and export these functions from `statsShadow.ts`:

- `convertAnalysisSettings()` - Convert Python snake_case to TypeScript camelCase
- `convertMetricSettings()` - Convert metric settings
- `runTsStatsForExperiment()` - Run TypeScript stats on experiment data
- `normalizeForComparison()` - Round floats, sort keys for comparison
- `compareResults()` - Compare normalized JSON

## Python Invocation

Simple one-shot subprocess approach (not using the pool):

1. Spawn Python process
2. Pass input JSON on stdin
3. Call `gbstats.gbstats.process_multiple_experiment_results`
4. Read JSON output from stdout

## Output Format

**On match (exit 0):**

```
✓ Stats comparison PASSED
  Python duration: 245ms
  TypeScript duration: 52ms
  Experiments: 1
  Metrics: 16
```

**On mismatch (exit 1):**

```
✗ Stats comparison FAILED

Experiment: homepage-nav-ios
  Metric: fact__fzty744smgu520t0
    Analysis 0 (bayesian/relative):
      Dimension "All", Variation 1:
        - chanceToWin: Python=0.4523 vs TS=0.4521 (diff: 0.0002)
        - expected: Python=0.0234 vs TS=0.0235 (diff: 0.0001)

Summary: 2 field differences across 1 metric
```

**On error (exit 2):**

```
✗ Stats comparison ERROR

TypeScript error: Cannot read property 'foo' of undefined
  at processSingleMetric (...)
```

## Input Format

Uses `ExperimentDataForStatsEngine[]` - the same format used by production shadow testing:

```typescript
interface ExperimentDataForStatsEngine {
  id: string;
  data: {
    metrics: Record<string, MetricSettingsForStatsEngine>;
    query_results: QueryResultsForStatsEngine[];
    analyses: AnalysisSettingsForStatsEngine[];
    bandit_settings?: BanditSettingsForStatsEngine | null;
  };
}
```

## Implementation Steps

1. Refactor `statsShadow.ts` to export helper functions
2. Create `compare-stats.ts` script
3. Add fixture JSON file with sample data
4. Add npm script to package.json for easy invocation
