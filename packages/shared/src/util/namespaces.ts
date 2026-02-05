// Define NamespaceValue type locally to avoid circular dependency
type LegacyNamespaceValue = {
  enabled: boolean;
  name: string;
  range: [number, number];
};

type MultiRangeNamespaceValue = {
  enabled: boolean;
  name: string;
  ranges: [number, number][];
  hashAttribute?: string;
  hashVersion?: number;
};

type NamespaceValue = LegacyNamespaceValue | MultiRangeNamespaceValue;

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
    return [namespace.range];
  }
  return namespace.ranges;
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

/**
 * Convert ranges to total percentage coverage
 */
export function rangesToPercentage(ranges: [number, number][]): number {
  const coverage = ranges.reduce((sum, [start, end]) => sum + (end - start), 0);
  return Math.round(coverage * 100 * 100) / 100; // Round to 2 decimals
}
