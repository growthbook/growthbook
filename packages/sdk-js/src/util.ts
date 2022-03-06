import { VariationRange } from "./types/growthbook";

function hashFnv32a(str: string): number {
  let hval = 0x811c9dc5;
  const l = str.length;

  for (let i = 0; i < l; i++) {
    hval ^= str.charCodeAt(i);
    hval +=
      (hval << 1) + (hval << 4) + (hval << 7) + (hval << 8) + (hval << 24);
  }
  return hval >>> 0;
}

export function hash(str: string): number {
  return (hashFnv32a(str) % 1000) / 1000;
}

export function getEqualWeights(n: number): number[] {
  if (n <= 0) return [];
  return new Array(n).fill(1 / n);
}

export function inNamespace(
  hashValue: string,
  namespace: [string, number, number]
): boolean {
  const n = hash(hashValue + "__" + namespace[0]);
  return n >= namespace[1] && n < namespace[2];
}

export function chooseVariation(n: number, ranges: VariationRange[]): number {
  for (let i = 0; i < ranges.length; i++) {
    if (n >= ranges[i][0] && n < ranges[i][1]) {
      return i;
    }
  }
  return -1;
}

export function getUrlRegExp(regexString: string): RegExp | undefined {
  try {
    const escaped = regexString.replace(/([^\\])\//g, "$1\\/");
    return new RegExp(escaped);
  } catch (e) {
    console.error(e);
    return undefined;
  }
}

export function getBucketRanges(
  numVariations: number,
  coverage: number = 1,
  weights?: number[]
): VariationRange[] {
  // Make sure coverage is within bounds
  if (coverage < 0) {
    if (process.env.NODE_ENV !== "production") {
      console.error("Experiment.coverage must be greater than or equal to 0");
    }
    coverage = 0;
  } else if (coverage > 1) {
    if (process.env.NODE_ENV !== "production") {
      console.error("Experiment.coverage must be less than or equal to 1");
    }
    coverage = 1;
  }

  // Default to equal weights if missing or invalid
  const equal = getEqualWeights(numVariations);
  weights = weights || equal;
  if (weights.length !== numVariations) {
    if (process.env.NODE_ENV !== "production") {
      console.error(
        "Experiment.weights array must be the same length as Experiment.variations"
      );
    }
    weights = equal;
  }

  // If weights don't add up to 1 (or close to it), default to equal weights
  const totalWeight = weights.reduce((w, sum) => sum + w, 0);
  if (totalWeight < 0.99 || totalWeight > 1.01) {
    if (process.env.NODE_ENV !== "production") {
      console.error("Experiment.weights must add up to 1");
    }
    weights = equal;
  }

  // Covert weights to ranges
  let cumulative = 0;
  return weights.map((w) => {
    const start = cumulative;
    cumulative += w;
    return [start, start + coverage * w];
  }) as VariationRange[];
}

export function getQueryStringOverride(
  id: string,
  url: string,
  numVariations: number
) {
  if (!url) {
    return null;
  }

  const search = url.split("?")[1];
  if (!search) {
    return null;
  }

  const match = search
    .replace(/#.*/, "") // Get rid of anchor
    .split("&") // Split into key/value pairs
    .map((kv) => kv.split("=", 2))
    .filter(([k]) => k === id) // Look for key that matches the experiment id
    .map(([, v]) => parseInt(v)); // Parse the value into an integer

  if (match.length > 0 && match[0] >= 0 && match[0] < numVariations)
    return match[0];

  return null;
}

export function isIncluded(include: () => boolean) {
  try {
    return include();
  } catch (e) {
    console.error(e);
    return false;
  }
}
