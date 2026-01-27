# Stats Comparison Script Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Create a TypeScript script that compares Python gbstats and TypeScript tsgbstats outputs to validate feature parity.

**Architecture:** The script loads a fixture JSON file, runs both Python (via subprocess) and TypeScript (direct import) stats engines on the same input, normalizes the results, and compares them. Exit code 0 = match, 1 = mismatch, 2 = error.

**Tech Stack:** TypeScript, Node.js child_process, tsgbstats package, Python gbstats package

---

### Task 1: Export Helper Functions from statsShadow.ts

**Files:**

- Modify: `packages/back-end/src/services/statsShadow.ts`

**Step 1: Export the conversion and comparison functions**

Add `export` keyword to these functions that are currently private:

- `convertAnalysisSettings` (line 46)
- `convertMetricSettings` (line 76)
- `runTsStatsForExperiment` (line 103)
- `runTsStatsEngine` (line 165)
- `normalizeForComparison` (line 203)
- `compareResults` (line 232)

Also export the `ComparisonResult` interface (line 34).

```typescript
// Change from:
function convertAnalysisSettings(
// To:
export function convertAnalysisSettings(

// Change from:
function convertMetricSettings(
// To:
export function convertMetricSettings(

// Change from:
function runTsStatsForExperiment(
// To:
export function runTsStatsForExperiment(

// Change from:
function runTsStatsEngine(
// To:
export function runTsStatsEngine(

// Change from:
function normalizeForComparison(
// To:
export function normalizeForComparison(

// Change from:
function compareResults(
// To:
export function compareResults(

// Change from:
interface ComparisonResult {
// To:
export interface ComparisonResult {
```

**Step 2: Verify the build still works**

Run: `cd packages/back-end && yarn tsc --noEmit 2>&1 | head -20`
Expected: No errors (or pre-existing errors unrelated to this change)

**Step 3: Commit**

```bash
git add packages/back-end/src/services/statsShadow.ts
git commit -m "refactor(statsShadow): export helper functions for reuse"
```

---

### Task 2: Create the Compare Stats Script

**Files:**

- Create: `packages/back-end/scripts/compare-stats.ts`

**Step 1: Create the script with all functionality**

```typescript
#!/usr/bin/env npx ts-node
/**
 * Compare Python gbstats and TypeScript tsgbstats outputs.
 *
 * Usage: npx ts-node scripts/compare-stats.ts
 *
 * Exit codes:
 *   0 - Results match
 *   1 - Results mismatch
 *   2 - Error (Python or TypeScript crashed)
 */

import { spawn } from "child_process";
import * as path from "path";
import * as fs from "fs";
import {
  ExperimentDataForStatsEngine,
  MultipleExperimentMetricAnalysis,
} from "shared/types/stats";
import {
  runTsStatsEngine,
  normalizeForComparison,
} from "../src/services/statsShadow";

// Fixture path - relative to this script
const FIXTURE_PATH = path.join(
  __dirname,
  "../../tsgbstats/test/fixtures/stats-comparison-fixture.json",
);

interface PythonResult {
  id: string;
  results?: unknown[];
  error?: string;
  stack_trace?: string;
  time: number;
}

/**
 * Run Python gbstats via subprocess.
 */
async function runPythonStats(
  experiments: ExperimentDataForStatsEngine[],
): Promise<{
  results: MultipleExperimentMetricAnalysis[];
  durationMs: number;
}> {
  const startTime = Date.now();
  const results: MultipleExperimentMetricAnalysis[] = [];

  for (const exp of experiments) {
    const result = await new Promise<PythonResult>((resolve, reject) => {
      const pythonScript = path.join(__dirname, "stats_server.py");
      const python = spawn("python3", ["-u", pythonScript], {
        cwd: path.join(__dirname, ".."),
        env: {
          ...process.env,
          PYTHONPATH: path.join(__dirname, "../../stats"),
        },
      });

      let stdout = "";
      let stderr = "";

      python.stdout.on("data", (data) => {
        stdout += data.toString();
      });

      python.stderr.on("data", (data) => {
        stderr += data.toString();
      });

      python.on("close", (code) => {
        if (stderr) {
          console.error("Python stderr:", stderr);
        }
        if (code !== 0 && !stdout) {
          reject(new Error(`Python exited with code ${code}: ${stderr}`));
          return;
        }
        try {
          // Parse the first line of output (stats_server.py outputs one JSON per line)
          const firstLine = stdout.trim().split("\n")[0];
          resolve(JSON.parse(firstLine));
        } catch (e) {
          reject(new Error(`Failed to parse Python output: ${stdout}`));
        }
      });

      python.on("error", (err) => {
        reject(err);
      });

      // Send input to Python
      const input = JSON.stringify({ id: exp.id, data: exp.data });
      python.stdin.write(input + "\n");
      python.stdin.end();
    });

    if (result.error) {
      results.push({
        id: result.id,
        results: [],
        banditResult: null,
        error: result.error,
        traceback: result.stack_trace || null,
      });
    } else {
      results.push({
        id: result.id,
        results: result.results as MultipleExperimentMetricAnalysis["results"],
        banditResult: null,
        error: null,
        traceback: null,
      });
    }
  }

  return { results, durationMs: Date.now() - startTime };
}

/**
 * Find differences between two objects recursively.
 */
function findDifferences(
  pythonObj: unknown,
  tsObj: unknown,
  path: string = "",
): string[] {
  const diffs: string[] = [];

  if (pythonObj === tsObj) return diffs;

  if (typeof pythonObj !== typeof tsObj) {
    diffs.push(
      `${path}: type mismatch (Python: ${typeof pythonObj}, TS: ${typeof tsObj})`,
    );
    return diffs;
  }

  if (pythonObj === null || tsObj === null) {
    if (pythonObj !== tsObj) {
      diffs.push(`${path}: Python=${pythonObj} vs TS=${tsObj}`);
    }
    return diffs;
  }

  if (typeof pythonObj === "number" && typeof tsObj === "number") {
    const diff = Math.abs(pythonObj - tsObj);
    if (diff > 1e-10) {
      diffs.push(
        `${path}: Python=${pythonObj} vs TS=${tsObj} (diff: ${diff.toExponential(2)})`,
      );
    }
    return diffs;
  }

  if (Array.isArray(pythonObj) && Array.isArray(tsObj)) {
    const maxLen = Math.max(pythonObj.length, tsObj.length);
    for (let i = 0; i < maxLen; i++) {
      if (i >= pythonObj.length) {
        diffs.push(`${path}[${i}]: missing in Python`);
      } else if (i >= tsObj.length) {
        diffs.push(`${path}[${i}]: missing in TS`);
      } else {
        diffs.push(...findDifferences(pythonObj[i], tsObj[i], `${path}[${i}]`));
      }
    }
    return diffs;
  }

  if (typeof pythonObj === "object" && typeof tsObj === "object") {
    const pythonKeys = Object.keys(pythonObj as Record<string, unknown>);
    const tsKeys = Object.keys(tsObj as Record<string, unknown>);
    const allKeys = new Set([...pythonKeys, ...tsKeys]);

    for (const key of allKeys) {
      const newPath = path ? `${path}.${key}` : key;
      if (!pythonKeys.includes(key)) {
        diffs.push(`${newPath}: missing in Python`);
      } else if (!tsKeys.includes(key)) {
        diffs.push(`${newPath}: missing in TS`);
      } else {
        diffs.push(
          ...findDifferences(
            (pythonObj as Record<string, unknown>)[key],
            (tsObj as Record<string, unknown>)[key],
            newPath,
          ),
        );
      }
    }
    return diffs;
  }

  if (pythonObj !== tsObj) {
    diffs.push(
      `${path}: Python=${JSON.stringify(pythonObj)} vs TS=${JSON.stringify(tsObj)}`,
    );
  }

  return diffs;
}

/**
 * Print detailed diff output.
 */
function printDiff(
  pythonResult: MultipleExperimentMetricAnalysis[],
  tsResult: MultipleExperimentMetricAnalysis[],
): void {
  const normalizedPython = normalizeForComparison(pythonResult);
  const normalizedTs = normalizeForComparison(tsResult);

  const diffs = findDifferences(normalizedPython, normalizedTs);

  if (diffs.length === 0) {
    console.log("No differences found after normalization.");
    return;
  }

  console.log("\nDifferences found:\n");

  // Group diffs by experiment/metric for readability
  const grouped: Record<string, string[]> = {};
  for (const diff of diffs) {
    const match = diff.match(/^\[(\d+)\]\.results\[(\d+)\]/);
    if (match) {
      const key = `Experiment ${match[1]}, Metric ${match[2]}`;
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(diff);
    } else {
      if (!grouped["Other"]) grouped["Other"] = [];
      grouped["Other"].push(diff);
    }
  }

  for (const [group, groupDiffs] of Object.entries(grouped)) {
    console.log(`  ${group}:`);
    // Limit output to first 10 diffs per group
    const toShow = groupDiffs.slice(0, 10);
    for (const d of toShow) {
      console.log(`    - ${d}`);
    }
    if (groupDiffs.length > 10) {
      console.log(`    ... and ${groupDiffs.length - 10} more`);
    }
    console.log();
  }

  console.log(`Summary: ${diffs.length} total differences`);
}

/**
 * Main function.
 */
async function main(): Promise<void> {
  console.log("Stats Comparison Test");
  console.log("=====================\n");

  // Load fixture
  console.log(`Loading fixture: ${FIXTURE_PATH}`);
  if (!fs.existsSync(FIXTURE_PATH)) {
    console.error(`\n✗ Fixture file not found: ${FIXTURE_PATH}`);
    process.exit(2);
  }

  let experiments: ExperimentDataForStatsEngine[];
  try {
    const fixtureContent = fs.readFileSync(FIXTURE_PATH, "utf-8");
    const fixture = JSON.parse(fixtureContent);
    // Handle both single experiment and array of experiments
    experiments = Array.isArray(fixture) ? fixture : [fixture];
  } catch (e) {
    console.error(`\n✗ Failed to parse fixture: ${e}`);
    process.exit(2);
  }

  const metricCount = experiments.reduce(
    (sum, exp) => sum + Object.keys(exp.data.metrics).length,
    0,
  );
  console.log(`  Experiments: ${experiments.length}`);
  console.log(`  Metrics: ${metricCount}\n`);

  // Run Python stats
  console.log("Running Python gbstats...");
  let pythonResult: MultipleExperimentMetricAnalysis[];
  let pythonDurationMs: number;
  try {
    const python = await runPythonStats(experiments);
    pythonResult = python.results;
    pythonDurationMs = python.durationMs;
    console.log(`  Duration: ${pythonDurationMs}ms`);

    // Check for Python errors
    const pythonError = pythonResult.find((r) => r.error);
    if (pythonError) {
      console.error(`\n✗ Python error: ${pythonError.error}`);
      if (pythonError.traceback) {
        console.error(pythonError.traceback);
      }
      process.exit(2);
    }
  } catch (e) {
    console.error(`\n✗ Python execution failed: ${e}`);
    process.exit(2);
  }

  // Run TypeScript stats
  console.log("\nRunning TypeScript tsgbstats...");
  let tsResult: MultipleExperimentMetricAnalysis[];
  let tsDurationMs: number;
  try {
    const startTime = Date.now();
    tsResult = runTsStatsEngine(experiments);
    tsDurationMs = Date.now() - startTime;
    console.log(`  Duration: ${tsDurationMs}ms`);

    // Check for TypeScript errors
    const tsError = tsResult.find((r) => r.error);
    if (tsError) {
      console.error(`\n✗ TypeScript error: ${tsError.error}`);
      if (tsError.traceback) {
        console.error(tsError.traceback);
      }
      process.exit(2);
    }
  } catch (e) {
    console.error(`\n✗ TypeScript execution failed: ${e}`);
    process.exit(2);
  }

  // Compare results
  console.log("\nComparing results...");
  const normalizedPython = normalizeForComparison(pythonResult);
  const normalizedTs = normalizeForComparison(tsResult);

  const pythonJson = JSON.stringify(normalizedPython);
  const tsJson = JSON.stringify(normalizedTs);

  if (pythonJson === tsJson) {
    console.log("\n✓ Stats comparison PASSED");
    console.log(`  Python duration: ${pythonDurationMs}ms`);
    console.log(`  TypeScript duration: ${tsDurationMs}ms`);
    console.log(`  Experiments: ${experiments.length}`);
    console.log(`  Metrics: ${metricCount}`);
    process.exit(0);
  } else {
    console.log("\n✗ Stats comparison FAILED");
    printDiff(pythonResult, tsResult);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(`\n✗ Unexpected error: ${e}`);
  process.exit(2);
});
```

**Step 2: Verify the script compiles**

Run: `cd packages/back-end && npx tsc --noEmit scripts/compare-stats.ts 2>&1 | head -20`
Expected: May show errors about module resolution (expected in scripts folder)

**Step 3: Commit**

```bash
git add packages/back-end/scripts/compare-stats.ts
git commit -m "feat: add stats comparison script for Python vs TypeScript validation"
```

---

### Task 3: Add NPM Script for Easy Invocation

**Files:**

- Modify: `packages/back-end/package.json`

**Step 1: Add the compare-stats script**

Add to the "scripts" section:

```json
"compare-stats": "npx ts-node --transpile-only -r tsconfig-paths/register scripts/compare-stats.ts"
```

**Step 2: Commit**

```bash
git add packages/back-end/package.json
git commit -m "feat: add npm script for stats comparison"
```

---

### Task 4: Run the Comparison Test

**Step 1: Execute the comparison**

Run: `cd packages/back-end && yarn compare-stats`

Expected output (if match):

```
Stats Comparison Test
=====================

Loading fixture: .../stats-comparison-fixture.json
  Experiments: 1
  Metrics: 16

Running Python gbstats...
  Duration: XXXms

Running TypeScript tsgbstats...
  Duration: XXXms

Comparing results...

✓ Stats comparison PASSED
  Python duration: XXXms
  TypeScript duration: XXXms
  Experiments: 1
  Metrics: 16
```

Or (if mismatch):

```
✗ Stats comparison FAILED

Differences found:
  ...
```

**Step 2: If there are differences, investigate**

The output will show which fields differ. This may indicate:

- Real bugs in TypeScript implementation
- Different ordering of results (should be handled by normalization)
- Minor floating point differences beyond epsilon (may need to adjust tolerance)

---

### Task 5: Final Verification and Commit

**Step 1: Run the full test**

Run: `cd packages/back-end && yarn compare-stats`
Expected: Exit code 0 (match) or documented differences

**Step 2: Create final commit if any fixes were needed**

If adjustments were made to fix issues discovered during testing:

```bash
git add -A
git commit -m "fix: address differences found in stats comparison"
```
