import { Namespaces } from "shared/types/organization";

// These types are defined locally (not imported from validators/shared) to avoid
// circular dependencies in the shared package's import graph.
// Keep in sync with the Zod schemas in validators/shared.ts.
type LegacyNamespaceValue = {
  enabled: boolean;
  name: string;
  range: [number, number];
  format?: "legacy"; // optional — matches legacyNamespaceValue Zod schema
};

type MultiRangeNamespaceValue = {
  enabled: boolean;
  name: string;
  ranges: [number, number][];
  hashAttribute?: string;
  hashVersion?: number;
  format: "multiRange";
};

export type NamespaceValue = LegacyNamespaceValue | MultiRangeNamespaceValue;

/**
 * Check if a namespace is using the legacy format (single range)
 */
export function isLegacyNamespaceFormat(
  namespace: NamespaceValue,
): namespace is LegacyNamespaceValue {
  return "range" in namespace && !("ranges" in namespace);
}

/**
 * Check if a namespace is using the multiRange format (multiple ranges)
 */
export function isMultiRangeNamespaceFormat(
  namespace: NamespaceValue,
): namespace is MultiRangeNamespaceValue {
  return "ranges" in namespace;
}

/**
 * Get ranges from a namespace regardless of format
 */
export function getNamespaceRanges(
  namespace: NamespaceValue,
): [number, number][] {
  if (isLegacyNamespaceFormat(namespace)) {
    return namespace.range ? [namespace.range] : [];
  }
  return namespace.ranges ?? [];
}

/**
 * Get hash attribute from namespace, with fallback to experiment's hash attribute
 */
export function getNamespaceHashAttribute(
  namespace: NamespaceValue,
  experimentHashAttribute: string,
): string {
  if (isMultiRangeNamespaceFormat(namespace) && namespace.hashAttribute) {
    return namespace.hashAttribute;
  }
  return experimentHashAttribute;
}

/**
 * Shape returned by public API endpoints for a namespace attached to a
 * feature rule or experiment phase. Keeps the legacy `range` field for
 * backward compatibility (populated with the first range) and adds the full
 * `ranges` list so multiRange namespaces are fully visible to API consumers.
 */
export function toApiNamespace(namespace: NamespaceValue | null | undefined):
  | {
      enabled: true;
      name: string;
      range: [number, number];
      ranges: [number, number][];
    }
  | undefined {
  if (!namespace?.enabled) return undefined;
  const ranges = getNamespaceRanges(namespace);
  return {
    enabled: true,
    name: namespace.name,
    range: ranges[0] ?? [0, 0],
    ranges,
  };
}

/**
 * Calculate total coverage of a namespace (sum of all ranges)
 */
export function calculateNamespaceCoverage(namespace: NamespaceValue): number {
  const ranges = getNamespaceRanges(namespace);
  return ranges.reduce((sum, [start, end]) => sum + (end - start), 0);
}

/**
 * Check if ranges overlap
 */
export function rangesOverlap(
  range1: [number, number],
  range2: [number, number],
): boolean {
  return range1[0] < range2[1] && range2[0] < range1[1];
}

/**
 * Validate that ranges don't overlap
 */
export function validateNonOverlappingRanges(ranges: [number, number][]): {
  valid: boolean;
  error?: string;
} {
  for (let i = 0; i < ranges.length; i++) {
    for (let j = i + 1; j < ranges.length; j++) {
      if (rangesOverlap(ranges[i], ranges[j])) {
        return {
          valid: false,
          error: `Ranges [${ranges[i][0]}, ${ranges[i][1]}] and [${ranges[j][0]}, ${ranges[j][1]}] overlap`,
        };
      }
    }
  }
  return { valid: true };
}

/**
 * Validate range values (must be between 0 and 1)
 */
export function validateRangeValues(ranges: [number, number][]): {
  valid: boolean;
  error?: string;
} {
  for (const [start, end] of ranges) {
    if (start < 0 || start > 1 || end < 0 || end > 1) {
      return {
        valid: false,
        error: `Range values must be between 0 and 1. Got [${start}, ${end}]`,
      };
    }
    if (start >= end) {
      return {
        valid: false,
        error: `Range start must be less than end. Got [${start}, ${end}]`,
      };
    }
  }
  return { valid: true };
}

/**
 * Convert percentage to ranges (splits evenly from 0)
 * E.g., 35% -> [[0, 0.35]]
 */
export function percentageToRanges(percentage: number): [number, number][] {
  const decimal = percentage / 100;
  if (decimal <= 0) return [];
  if (decimal >= 1) return [[0, 1]];
  return [[0, decimal]];
}

export function namespacesToMap(
  namespaces?: Namespaces[],
): Map<
  string,
  { hashAttribute?: string; seed?: string; format?: "legacy" | "multiRange" }
> {
  if (!namespaces) return new Map();
  return new Map(
    namespaces.map((ns) => [
      ns.name,
      {
        hashAttribute:
          ("hashAttribute" in ns ? ns.hashAttribute : undefined) || "id",
        seed: ("seed" in ns ? ns.seed : undefined) || ns.name,
        format: ns.format,
      },
    ]),
  );
}

/**
 * Convert ranges to total percentage coverage
 */
export function rangesToPercentage(ranges: [number, number][]): number {
  const coverage = ranges.reduce((sum, [start, end]) => sum + (end - start), 0);
  return Math.round(coverage * 100 * 100) / 100; // Round to 2 decimals
}

/**
 * Determine whether moving from prevRanges to currRanges would drop any users.
 *
 * Returns true when any part of prevRanges is no longer covered by currRanges —
 * i.e. when the new allocation is not a superset of the old one.
 * This catches both shrinking total coverage AND range shifts that preserve
 * total coverage but exclude previously-included users (e.g. [0.2,0.6] → [0.0,0.4]).
 */
export function hasNarrowedRanges(
  prevRanges: [number, number][],
  currRanges: [number, number][],
): boolean {
  for (const [prevStart, prevEnd] of prevRanges) {
    // Find current ranges that overlap this previous range, sorted by start
    const overlapping = currRanges
      .filter(([cs, ce]) => cs < prevEnd && ce > prevStart)
      .sort((a, b) => a[0] - b[0]);

    if (overlapping.length === 0) return true;

    // Walk the overlapping ranges and check they fully cover [prevStart, prevEnd]
    let covered = prevStart;
    for (const [cs, ce] of overlapping) {
      if (cs > covered) return true; // Gap in coverage
      covered = Math.max(covered, ce);
    }
    if (covered < prevEnd) return true; // Tail of range not covered
  }
  return false;
}
