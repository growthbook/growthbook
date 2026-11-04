import type { FeatureInterface } from "shared/types/feature";
import type { RampAlertFilters } from "shared/validators";

// Each list matches any of its values; different filters must all match. An
// empty list (`?tag=` or `customFields[team]=`) restricts nothing, so it doesn't
// count toward the filter a rollback requires.
export function hasRampAlertFilters(filters: RampAlertFilters): boolean {
  return (
    !!filters.environment?.length ||
    !!filters.project?.length ||
    !!filters.tag?.length ||
    !!filters.feature?.length ||
    Object.values(filters.customFields ?? {}).some((v) => v.length > 0)
  );
}

function anyOf(wanted: string[] | undefined, actual: string[]): boolean {
  return !wanted?.length || wanted.some((w) => actual.includes(w));
}

// Multi-select custom fields hold arrays; everything else is a single value.
function customFieldValues(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  return (Array.isArray(value) ? value : [value]).map(String);
}

export function featureMatchesRampAlertFilters(
  feature: Pick<FeatureInterface, "id" | "project" | "tags" | "customFields">,
  filters: RampAlertFilters,
): boolean {
  return (
    anyOf(filters.feature, [feature.id]) &&
    anyOf(filters.project, feature.project ? [feature.project] : []) &&
    anyOf(filters.tag, feature.tags ?? []) &&
    Object.entries(filters.customFields ?? {}).every(([key, values]) =>
      anyOf(values, customFieldValues(feature.customFields?.[key])),
    )
  );
}

// A ramp matches when it reaches one of the filtered environments and any
// feature it controls matches the feature filters.
export function rampMatchesAlertFilters(
  {
    features,
    environments,
  }: {
    features: Pick<
      FeatureInterface,
      "id" | "project" | "tags" | "customFields"
    >[];
    environments: string[];
  },
  filters: RampAlertFilters,
): boolean {
  return (
    anyOf(filters.environment, environments) &&
    features.some((f) => featureMatchesRampAlertFilters(f, filters))
  );
}
