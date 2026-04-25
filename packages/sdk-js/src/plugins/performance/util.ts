import type { GrowthBook } from "../../GrowthBook";
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

export function detectEnv(): "browser" | "node" | "unknown" {
  if (typeof window !== "undefined" && typeof window.document !== "undefined")
    return "browser";
  if (typeof process !== "undefined" && process.versions?.node) return "node";
  return "unknown";
}

// Sync the current URL into GrowthBook so subsequent events are attributed
// to the new page. Dispatch covers autoAttributesPlugin (UTM/title refresh);
// setURL is the direct path that works without it. Both are idempotent.
export function syncGrowthBookUrl(gb: GrowthBook) {
  try {
    document.dispatchEvent(new Event("growthbookrefresh"));
  } catch {
    // noop
  }
  try {
    void gb.setURL(window.location.href);
  } catch {
    // noop
  }
}
