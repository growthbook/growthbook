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
