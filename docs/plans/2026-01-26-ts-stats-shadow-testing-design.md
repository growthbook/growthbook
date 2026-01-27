# TypeScript Stats Shadow Testing Design

## Overview

Shadow testing system to validate the TypeScript stats engine (`tsgbstats`) against the production Python stats engine (`gbstats`) by running both in parallel and comparing results.

## Goals

- Run TypeScript stats calculations alongside Python without blocking user requests
- Store both responses for comparison
- Identify matches and mismatches with full diff visibility
- Enable easy cleanup after validation is complete

## Architecture

```
runStatsEngine() called
        │
        ├──────────────────────────────┐
        │                              │
        ▼                              ▼
   Python gbstats              TypeScript tsgbstats
   (sync, blocking)            (async, fire-and-forget)
        │                              │
        │                              ▼
        │                      Compare results
        │                              │
        │                              ▼
        │                      Store to MongoDB
        │                      (StatsShadowComparison)
        │
        ▼
   Return Python result
   (unchanged behavior)
```

## Key Components

### 1. Shadow Runner (`services/statsShadow.ts`)

New service that:

- Receives the same input as Python
- Calls TypeScript tsgbstats
- Compares results with Python output using JSON string comparison
- Stores comparison to database

### 2. Comparison Model (`models/StatsShadowComparisonModel.ts`)

MongoDB collection storing:

- Full Python response with timing
- Full TypeScript response with timing (or error)
- Comparison status and diff details
- Metadata (experiment ID, timestamp, etc.)

### 3. Integration Point

Modified `runStatsEngine()` in `services/stats.ts` that:

- Checks `ENABLE_TS_STATS_SHADOW` env var
- Spawns shadow comparison in background (non-blocking)
- Returns Python result immediately (unchanged behavior)

## Data Model

**Collection: `stats_shadow_comparisons`**

```typescript
{
  id: string;                    // "ssc_abc123"
  organization: string;          // Org ID for multi-tenancy

  // Context
  experimentId: string;          // Which experiment
  snapshotId?: string;           // Which snapshot (if available)

  // Input (what was sent)
  input: {
    experiments: ExperimentDataForStatsEngine[];
  };

  // Results
  pythonResult: {
    results: MultipleExperimentMetricAnalysis[];
    durationMs: number;          // End-to-end timing
  };

  tsResult?: {
    results: MultipleExperimentMetricAnalysis[];
    durationMs: number;          // End-to-end timing
  };

  // Error case
  tsError?: {
    message: string;
    stack?: string;
  };

  // Comparison
  status: 'match' | 'mismatch' | 'ts_error';
  diff?: {
    summary: string;
    pythonJson: string;
    tsJson: string;
  };

  // Timestamps
  dateCreated: Date;
  dateUpdated: Date;
}
```

**Indexes:**

- `(organization, dateCreated)` - For cleanup queries
- `(organization, status)` - For finding mismatches
- `(experimentId)` - For experiment-specific lookups

## Comparison Logic

Strict JSON string comparison with no tolerance:

```typescript
function compareResults(
  pythonResult: MultipleExperimentMetricAnalysis[],
  tsResult: MultipleExperimentMetricAnalysis[],
): ComparisonResult {
  const pythonJson = JSON.stringify(pythonResult);
  const tsJson = JSON.stringify(tsResult);

  if (pythonJson === tsJson) {
    return { status: "match" };
  }

  return {
    status: "mismatch",
    diff: {
      summary: `JSON strings differ (Python: ${pythonJson.length} chars, TS: ${tsJson.length} chars)`,
      pythonJson,
      tsJson,
    },
  };
}
```

This approach:

- Catches ordering differences
- Catches floating-point serialization differences
- Catches field naming inconsistencies
- Matches real-world behavior (Python goes through JSON serialization)

## Integration Flow

```typescript
// In services/stats.ts
export async function runStatsEngine(
  experiments: ExperimentDataForStatsEngine[],
  context: ReqContext | ApiReqContext,
): Promise<MultipleExperimentMetricAnalysis[]> {
  const startTime = Date.now();

  // Run Python (existing behavior, unchanged)
  const pythonResult = await runPythonStatsEngine(experiments);
  const pythonDurationMs = Date.now() - startTime;

  // Fire-and-forget shadow comparison (non-blocking)
  if (process.env.ENABLE_TS_STATS_SHADOW === "true") {
    runShadowComparison({
      experiments,
      pythonResult,
      pythonDurationMs,
      context,
    }).catch((err) => {
      logger.error("Shadow comparison failed", { error: err });
    });
  }

  // Return Python result immediately (unchanged behavior)
  return pythonResult;
}
```

## Files to Create/Modify

### New Files

1. **`packages/back-end/src/models/StatsShadowComparisonModel.ts`**
   - BaseModel-based MongoDB model
   - CRUD operations for comparison records

2. **`packages/back-end/src/services/statsShadow.ts`**
   - `runShadowComparison()` function
   - `compareResults()` JSON string comparison
   - TypeScript stats engine wrapper

3. **`packages/shared/src/validators/statsShadowComparison.ts`**
   - Zod schema for the collection

### Modified Files

4. **`packages/back-end/src/services/stats.ts`**
   - Add fire-and-forget call to shadow comparison in `runStatsEngine()`

5. **`packages/back-end/src/services/context.ts`**
   - Register new model in `ModelName` union and `modelClasses`

6. **`packages/back-end/package.json`**
   - Add `tsgbstats` as workspace dependency

## Configuration

**Environment Variable:**

- `ENABLE_TS_STATS_SHADOW` - Set to `"true"` to enable shadow testing

## Error Handling

When TypeScript calculation fails:

- Store comparison record with `status: 'ts_error'`
- Include full input payload for debugging
- Include error message and stack trace
- No diff computed (only Python result available)

## Cleanup

After validation is complete, the `stats_shadow_comparisons` collection can be dropped entirely or records can be deleted by date range.
