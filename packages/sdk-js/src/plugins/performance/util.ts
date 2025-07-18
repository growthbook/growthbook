import { hash, toString } from "../../util";
import { Attributes } from "../../types/growthbook";

export function shouldSample({
  rate,
  hashAttribute,
  attributes,
  seed = "",
}: {
  rate: number;
  hashAttribute?: string;
  attributes?: Attributes;
  seed?: string;
}) {
  const attributeValue = hashAttribute
    ? attributes?.[hashAttribute]
    : undefined;
  const samplingValue = toString(attributeValue);
  if (typeof samplingValue === "string") {
    const v = hash(seed, samplingValue, 2);
    return v !== null && v < rate;
  }
  return Math.random() < rate;
}

export function detectEnv(): "browser" | "node" | "unknown" {
  if (typeof window !== "undefined" && typeof window.document !== "undefined")
    return "browser";
  if (typeof process !== "undefined" && process.versions?.node) return "node";
  return "unknown";
}

/**
 * Determines if an error should be logged based on debounce settings
 * Prevents the same error from being logged multiple times in a short period
 * Returns true if the error should be logged, false if it should be debounced (skipped)
 */
export function shouldLogAfterDebouncing(
  message: string,
  stack: string,
  debounceTimeout: number,
  timestampsMap: Map<string, number>
): boolean {
  if (debounceTimeout <= 0) return true;

  const key = message + stack;
  const now = Date.now();
  const last = timestampsMap.get(key) || 0;

  if (now - last < debounceTimeout) {
    return false;
  }

  timestampsMap.set(key, now);
  return true;
}
