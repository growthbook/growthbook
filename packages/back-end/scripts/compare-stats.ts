#!/usr/bin/env npx ts-node
/* eslint-disable no-console */
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
// eslint-disable-next-line no-restricted-imports
import {
  runTsStatsEngine,
  normalizeForComparison,
} from "../src/services/statsShadow";

/**
 * Tolerance for floating-point comparison.
 *
 * Python (scipy) and TypeScript (@stdlib) use different implementations
 * for statistical functions (norm.cdf, norm.ppf, truncnorm, etc.), leading to
 * small numerical differences. These differences are most pronounced in:
 *
 * - chanceToWin: up to ~2e-6 (uses CDF heavily, accumulates precision differences)
 * - ci bounds, expected, risk: up to ~1e-7
 * - stddev: typically 1e-9 to 1e-8
 *
 * A tolerance of 2e-6 allows for these expected library differences while
 * still catching actual implementation bugs (which would typically cause
 * differences on the order of 1e-3 or larger).
 */
const COMPARISON_TOLERANCE = 2e-6;

/**
 * Known limitation: "scaled" difference type is not fully implemented in TypeScript.
 *
 * Python's gbstats has a `scale_result` function that multiplies results by
 * `daily_traffic = total_users / (traffic_percentage * phase_length_days)`.
 * This scaling is not yet implemented in TypeScript tsgbstats.
 *
 * TODO: Implement scale_result in TypeScript to support "scaled" difference type.
 * For now, we skip analyses with difference_type="scaled" during comparison.
 */
const SKIP_SCALED_ANALYSES = true;

/**
 * Filter out "scaled" analyses from comparison results.
 *
 * The "scaled" difference type requires a scale_result post-processing step
 * that is not yet implemented in TypeScript. We filter these out to allow
 * meaningful comparison of "relative" and "absolute" analyses.
 */
function filterScaledAnalyses(
  results: MultipleExperimentMetricAnalysis[],
  experiments: ExperimentDataForStatsEngine[],
): MultipleExperimentMetricAnalysis[] {
  if (!SKIP_SCALED_ANALYSES) {
    return results;
  }

  return results.map((expResult, expIdx) => {
    const experiment = experiments[expIdx];
    const analyses = experiment?.data?.analyses || [];

    // Find indices of non-scaled analyses
    const nonScaledIndices = analyses
      .map((a, i) => (a.difference_type !== "scaled" ? i : -1))
      .filter((i) => i >= 0);

    // Filter results to only include non-scaled analyses
    const filteredResults = expResult.results?.map((metricResult) => ({
      ...metricResult,
      analyses: metricResult.analyses?.filter((_, i) =>
        nonScaledIndices.includes(i),
      ),
    }));

    return {
      ...expResult,
      results: filteredResults,
    };
  });
}

// Fixture path - relative to this script
const FIXTURE_PATH = path.join(
  __dirname,
  "../../tsgbstats/test/fixtures/stats-comparison-fixture.json",
);

interface PythonResult {
  id: string;
  results?: unknown[];
  banditResult?: unknown;
  error?: string;
  stack_trace?: string;
  traceback?: string;
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
        banditResult:
          (result.banditResult as MultipleExperimentMetricAnalysis["banditResult"]) ||
          null,
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
  pathStr: string = "",
): string[] {
  const diffs: string[] = [];

  if (pythonObj === tsObj) return diffs;

  if (typeof pythonObj !== typeof tsObj) {
    diffs.push(
      `${pathStr}: type mismatch (Python: ${typeof pythonObj}, TS: ${typeof tsObj})`,
    );
    return diffs;
  }

  if (pythonObj === null || tsObj === null) {
    if (pythonObj !== tsObj) {
      diffs.push(`${pathStr}: Python=${pythonObj} vs TS=${tsObj}`);
    }
    return diffs;
  }

  if (typeof pythonObj === "number" && typeof tsObj === "number") {
    const diff = Math.abs(pythonObj - tsObj);
    if (diff > COMPARISON_TOLERANCE) {
      diffs.push(
        `${pathStr}: Python=${pythonObj} vs TS=${tsObj} (diff: ${diff.toExponential(2)})`,
      );
    }
    return diffs;
  }

  if (Array.isArray(pythonObj) && Array.isArray(tsObj)) {
    const maxLen = Math.max(pythonObj.length, tsObj.length);
    for (let i = 0; i < maxLen; i++) {
      if (i >= pythonObj.length) {
        diffs.push(`${pathStr}[${i}]: missing in Python`);
      } else if (i >= tsObj.length) {
        diffs.push(`${pathStr}[${i}]: missing in TS`);
      } else {
        diffs.push(
          ...findDifferences(pythonObj[i], tsObj[i], `${pathStr}[${i}]`),
        );
      }
    }
    return diffs;
  }

  if (typeof pythonObj === "object" && typeof tsObj === "object") {
    const pythonKeys = Object.keys(pythonObj as Record<string, unknown>);
    const tsKeys = Object.keys(tsObj as Record<string, unknown>);
    const allKeys = new Set([...pythonKeys, ...tsKeys]);

    for (const key of allKeys) {
      const newPath = pathStr ? `${pathStr}.${key}` : key;
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
      `${pathStr}: Python=${JSON.stringify(pythonObj)} vs TS=${JSON.stringify(tsObj)}`,
    );
  }

  return diffs;
}

/**
 * Print detailed diff output from a pre-computed differences array.
 */
function printDiffFromDiffs(diffs: string[]): void {
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

  // Filter out scaled analyses if needed
  let filteredPython = pythonResult;
  let filteredTs = tsResult;
  let scaledAnalysesSkipped = 0;

  if (SKIP_SCALED_ANALYSES) {
    // Count scaled analyses for reporting
    for (const exp of experiments) {
      const analyses = exp?.data?.analyses || [];
      scaledAnalysesSkipped += analyses.filter(
        (a) => a.difference_type === "scaled",
      ).length;
    }

    if (scaledAnalysesSkipped > 0) {
      console.log(
        `\nNote: Skipping ${scaledAnalysesSkipped} "scaled" analyses (not yet implemented in TypeScript)`,
      );
    }

    filteredPython = filterScaledAnalyses(pythonResult, experiments);
    filteredTs = filterScaledAnalyses(tsResult, experiments);
  }

  // Compare results using tolerance-based comparison
  console.log("\nComparing results...");
  const normalizedPython = normalizeForComparison(filteredPython);
  const normalizedTs = normalizeForComparison(filteredTs);

  // Use tolerance-based comparison instead of strict JSON equality
  const diffs = findDifferences(normalizedPython, normalizedTs);

  if (diffs.length === 0) {
    console.log("\n✓ Stats comparison PASSED");
    console.log(`  Python duration: ${pythonDurationMs}ms`);
    console.log(`  TypeScript duration: ${tsDurationMs}ms`);
    console.log(`  Experiments: ${experiments.length}`);
    console.log(`  Metrics: ${metricCount}`);
    console.log(`  Tolerance: ${COMPARISON_TOLERANCE.toExponential()}`);
    if (scaledAnalysesSkipped > 0) {
      console.log(`  Note: ${scaledAnalysesSkipped} "scaled" analyses skipped`);
    }
    process.exit(0);
  } else {
    console.log("\n✗ Stats comparison FAILED");
    console.log(`  Tolerance: ${COMPARISON_TOLERANCE.toExponential()}`);
    if (scaledAnalysesSkipped > 0) {
      console.log(
        `  Note: ${scaledAnalysesSkipped} "scaled" analyses were excluded from comparison`,
      );
    }
    printDiffFromDiffs(diffs);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(`\n✗ Unexpected error: ${e}`);
  process.exit(2);
});
