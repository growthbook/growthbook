import type { ImplementationType } from "../validators/experiments";

export type ImplementationLinkages = {
  linkedFeatures?: string[] | null;
  hasVisualChangesets?: boolean | null;
  hasURLRedirects?: boolean | null;
  implementationType?: ImplementationType | null;
};

// The kinds a user may pick. "multi" is only ever derived; "none" is only ever
// assigned — by an import, or when the last implementation is removed.
export const SELECTABLE_IMPLEMENTATION_TYPES: ImplementationType[] = [
  "values",
  "feature",
  "urlredirect",
  "visual",
];

// What an experiment is left as once nothing is wired up any more. A chosen
// kind that was never wired ("values" before its flag exists) is kept.
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

// What the linkages alone say. "values" cannot be derived here — the managed
// marker lives on the flag — so it is always stored when the flag is adopted.
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

// What is actually wired up wins over what was stored; the stored value only
// speaks while nothing is linked. A managed flag is one linked flag, so
// "values" stands beside a single feature.
export function getImplementationType(
  exp: ImplementationLinkages,
): ImplementationType | undefined {
  const stored = exp.implementationType ?? undefined;
  const derived = deriveImplementationType(exp);
  if (!derived) return stored === "multi" ? undefined : stored;
  if (stored === "values" && derived === "feature") return "values";
  return derived;
}

// Free to change until something is wired up; then locked until every linkage
// is removed. Adopting the label the linkages already imply is always allowed.
export function canChangeImplementationType(
  exp: ImplementationLinkages,
  next: ImplementationType,
): boolean {
  if (!hasImplementationLinkages(exp)) return true;
  return next === deriveImplementationType(exp);
}
