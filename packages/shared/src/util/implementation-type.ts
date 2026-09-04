import type { ImplementationType } from "../validators/experiments";

export type ImplementationLinkages = {
  linkedFeatures?: string[] | null;
  hasVisualChangesets?: boolean | null;
  hasURLRedirects?: boolean | null;
  implementationType?: ImplementationType | null;
};

// "multi" is only ever derived; "none" only assigned (import, or last linkage removed).
export const SELECTABLE_IMPLEMENTATION_TYPES: ImplementationType[] = [
  "values",
  "feature",
  "urlredirect",
  "visual",
];

// "values" chosen before its flag exists is kept; other kinds settle to "none".
export function implementationTypeAfterUnlink(
  exp: ImplementationLinkages,
): ImplementationType | undefined {
  if (hasImplementationLinkages(exp))
    return exp.implementationType ?? undefined;
  return exp.implementationType && exp.implementationType !== "values"
    ? "none"
    : (exp.implementationType ?? undefined);
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
