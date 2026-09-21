import type { ImplementationType } from "../validators/experiments";

export type ImplementationLinkages = {
  linkedFeatures?: string[] | null;
  hasVisualChangesets?: boolean | null;
  hasURLRedirects?: boolean | null;
  implementationType?: ImplementationType | null;
};

// "multi" is only ever derived; "none" is only assigned by an import.
export const SELECTABLE_IMPLEMENTATION_TYPES: ImplementationType[] = [
  "values",
  "feature",
  "urlredirect",
  "visual",
];

// Removing the last implementation keeps the chosen kind, so the card still
// offers that kind; only a legacy mix has no single kind to keep.
export function implementationTypeAfterUnlink(
  exp: ImplementationLinkages,
): ImplementationType | undefined {
  if (exp.implementationType === "multi" && !hasImplementationLinkages(exp))
    return undefined;
  return exp.implementationType ?? undefined;
}

export function hasImplementationLinkages(
  exp: ImplementationLinkages,
): boolean {
  return (
    (exp.linkedFeatures?.length ?? 0) > 0 ||
    !!exp.hasVisualChangesets ||
    !!exp.hasURLRedirects
  );
}

// "values" is never derived: the managed marker lives on the flag, so adoption stores it.
export function deriveImplementationType(
  exp: ImplementationLinkages,
): ImplementationType | undefined {
  const kinds: ImplementationType[] = [];
  if ((exp.linkedFeatures?.length ?? 0) > 0) kinds.push("feature");
  if (exp.hasVisualChangesets) kinds.push("visual");
  if (exp.hasURLRedirects) kinds.push("urlredirect");
  if (kinds.length > 1) return "multi";
  return kinds[0];
}

// Linkages win; the stored type only speaks while nothing is linked.
// A managed flag is one linked flag, so "values" stands beside a single feature.
export function getImplementationType(
  exp: ImplementationLinkages,
): ImplementationType | undefined {
  const stored = exp.implementationType ?? undefined;
  const derived = deriveImplementationType(exp);
  if (!derived) return stored === "multi" ? undefined : stored;
  if (stored === "values" && derived === "feature") return "values";
  return derived;
}

// Locked while anything is linked, except to the label the linkages already imply.
export function canChangeImplementationType(
  exp: ImplementationLinkages,
  next: ImplementationType,
): boolean {
  if (!hasImplementationLinkages(exp)) return true;
  return next === deriveImplementationType(exp);
}
