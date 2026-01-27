/**
 * Test utility functions for rounding and comparing results.
 */

const DECIMALS = 5;

/**
 * Round a number to the specified number of decimal places.
 */
export function round(
  x: number | null | undefined,
  decimals: number = DECIMALS,
): number | null {
  if (x === null || x === undefined) {
    return null;
  }
  if (!Number.isFinite(x)) {
    return x; // Keep Infinity as-is
  }
  const factor = Math.pow(10, decimals);
  return Math.round(x * factor) / factor;
}

/**
 * Round all numeric values in an object/array recursively.
 */
export function roundDeep<T>(obj: T, decimals: number = DECIMALS): T {
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (typeof obj === "number") {
    return round(obj, decimals) as T;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => roundDeep(item, decimals)) as T;
  }

  if (typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      // Skip rounding for certain string fields
      if (
        key === "error_message" ||
        key === "errorMessage" ||
        key === "risk_type" ||
        key === "riskType" ||
        key === "p_value_error_message" ||
        key === "pValueErrorMessage" ||
        key === "dist" ||
        key === "type"
      ) {
        result[key] = value;
      } else {
        result[key] = roundDeep(value, decimals);
      }
    }
    return result as T;
  }

  return obj;
}

/**
 * Round a result dictionary for comparison.
 */
export function roundResultDict(
  result: Record<string, unknown>,
  decimals: number = DECIMALS,
): Record<string, unknown> {
  return roundDeep(result, decimals);
}

/**
 * Check if two numbers are approximately equal.
 */
export function approxEqual(
  a: number | null,
  b: number | null,
  tolerance: number = 1e-5,
): boolean {
  if (a === null && b === null) {
    return true;
  }
  if (a === null || b === null) {
    return false;
  }
  if (!Number.isFinite(a) && !Number.isFinite(b)) {
    return a === b; // Both Infinity or both -Infinity
  }
  if (!Number.isFinite(a) || !Number.isFinite(b)) {
    return false;
  }
  return Math.abs(a - b) <= tolerance;
}

/**
 * Convert snake_case to camelCase.
 */
export function snakeToCamel(str: string): string {
  return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}

/**
 * Convert camelCase to snake_case.
 */
export function camelToSnake(str: string): string {
  return str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

/**
 * Convert object keys from snake_case to camelCase.
 */
export function keysToCamel<T>(obj: T): T {
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => keysToCamel(item)) as T;
  }

  if (typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      const camelKey = snakeToCamel(key);
      result[camelKey] = keysToCamel(value);
    }
    return result as T;
  }

  return obj;
}

/**
 * Convert object keys from camelCase to snake_case.
 */
export function keysToSnake<T>(obj: T): T {
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => keysToSnake(item)) as T;
  }

  if (typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      const snakeKey = camelToSnake(key);
      result[snakeKey] = keysToSnake(value);
    }
    return result as T;
  }

  return obj;
}

/**
 * Filter an object to only include keys that exist in the expected reference object.
 * This is useful for comparing test results when the actual output has extra fields.
 */
export function filterToExpectedFields<T>(actual: T, expected: T): T {
  if (actual === null || actual === undefined) {
    return actual;
  }

  if (expected === null || expected === undefined) {
    return actual;
  }

  if (Array.isArray(actual) && Array.isArray(expected)) {
    return actual.map((item, idx) => {
      const expectedItem = idx < expected.length ? expected[idx] : expected[0];
      return filterToExpectedFields(item, expectedItem);
    }) as T;
  }

  if (typeof actual === "object" && typeof expected === "object") {
    const result: Record<string, unknown> = {};
    const expectedObj = expected as Record<string, unknown>;
    for (const [key, value] of Object.entries(actual)) {
      if (key in expectedObj) {
        result[key] = filterToExpectedFields(value, expectedObj[key]);
      }
    }
    return result as T;
  }

  return actual;
}
