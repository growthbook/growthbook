/**
 * Fixture loading utilities for tests.
 */

import * as fs from "fs";
import * as path from "path";

const FIXTURES_DIR = path.join(__dirname, "..", "fixtures");

export interface FixtureMetadata {
  gbstats_version: string;
  decimals: number;
}

export interface FixtureTestCase {
  inputs: Record<string, unknown>;
  expected: Record<string, unknown>;
}

export interface FixtureFile {
  metadata: FixtureMetadata;
  test_cases: Record<string, Record<string, FixtureTestCase>>;
}

/**
 * Revive special string values like "Infinity" back to their numeric form.
 */
function reviveSpecialValues(key: string, value: unknown): unknown {
  if (value === "Infinity") return Infinity;
  if (value === "-Infinity") return -Infinity;
  if (value === "NaN") return NaN;
  return value;
}

/**
 * Load a fixture file by relative path.
 */
export function loadFixtures(relativePath: string): FixtureFile {
  const fullPath = path.join(FIXTURES_DIR, relativePath);
  if (!fs.existsSync(fullPath)) {
    throw new Error(
      `Fixture file not found: ${fullPath}. Run 'pnpm fixtures:generate' first.`,
    );
  }
  const content = fs.readFileSync(fullPath, "utf-8");
  return JSON.parse(content, reviveSpecialValues) as FixtureFile;
}

/**
 * Load frequentist test fixtures.
 */
export function loadFrequentistFixtures(): FixtureFile {
  return loadFixtures("frequentist/tests.fixtures.json");
}

/**
 * Load Bayesian test fixtures.
 */
export function loadBayesianFixtures(): FixtureFile {
  return loadFixtures("bayesian/tests.fixtures.json");
}

/**
 * Load statistics fixtures.
 */
export function loadStatisticsFixtures(): FixtureFile {
  return loadFixtures("statistics.fixtures.json");
}

/**
 * Load utils fixtures.
 */
export function loadUtilsFixtures(): FixtureFile {
  return loadFixtures("utils.fixtures.json");
}

/**
 * Load mid-experiment power fixtures.
 */
export function loadMidExperimentPowerFixtures(): FixtureFile {
  return loadFixtures("midexperimentpower.fixtures.json");
}

/**
 * Load post-stratification fixtures.
 */
export function loadPostStratificationFixtures(): FixtureFile {
  return loadFixtures("frequentist/postStratification.fixtures.json");
}

/**
 * Load high-level API (gbstats) fixtures.
 */
export function loadGbstatsFixtures(): FixtureFile {
  return loadFixtures("gbstats.fixtures.json");
}

/**
 * Load devtools/simulation fixtures.
 */
export function loadDevtoolsFixtures(): FixtureFile {
  return loadFixtures("devtools/simulation.fixtures.json");
}

/**
 * Get a specific test case from fixtures.
 */
export function getTestCase(
  fixtures: FixtureFile,
  testClass: string,
  testMethod: string,
): FixtureTestCase {
  const classFixtures = fixtures.test_cases[testClass];
  if (!classFixtures) {
    throw new Error(`Test class not found in fixtures: ${testClass}`);
  }
  const testCase = classFixtures[testMethod];
  if (!testCase) {
    throw new Error(
      `Test method not found in fixtures: ${testClass}.${testMethod}`,
    );
  }
  return testCase;
}
