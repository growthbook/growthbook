import { hash, toString } from "../../util";
import type { Attributes } from "../../types/growthbook";

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
  if (rate >= 1) return true;
  if (rate <= 0) return false;
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

// Bad rates warn and fall back rather than throw — an observability typo
// must never take the SDK down with it
export function normalizeSamplingRate(
  rate: number | undefined,
  fallback: number,
  label: string,
): number {
  if (rate === undefined) return fallback;
  if (typeof rate !== "number" || !isFinite(rate) || rate < 0 || rate > 1) {
    console.warn(
      `browserEventsPlugin: ${label} must be between 0 and 1 (got ${rate}); using ${fallback}`,
    );
    return fallback;
  }
  return rate;
}

export function detectEnv(): "browser" | "node" | "unknown" {
  if (typeof window !== "undefined" && typeof window.document !== "undefined")
    return "browser";
  if (typeof process !== "undefined" && process.versions?.node) return "node";
  return "unknown";
}

// The fragment is never useful for attribution and often carries OAuth tokens
export function currentPageUrl(): string {
  const { origin, pathname, search } = window.location;
  return origin + pathname + search;
}

// Prerendered pages (speculation rules) run scripts before the user sees
// anything; observability must wait for activation
export function whenActivated(fn: () => void): void {
  const doc = document as Document & { prerendering?: boolean };
  if (doc.prerendering) {
    doc.addEventListener("prerenderingchange", () => fn(), { once: true });
  } else {
    fn();
  }
}
