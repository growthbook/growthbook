import { selectableImplementationTypes } from "../constants";
import type {
  ExperimentType,
  ImplementationType,
} from "../validators/experiments";

export type ImplementationLinkages = {
  linkedFeatures?: string[] | null;
  hasVisualChangesets?: boolean | null;
  hasURLRedirects?: boolean | null;
  implementationType?: ImplementationType | null;
  // The experiment owns one of its flags. Experiments adopted before the type
  // was stored only carry the flag's marker.
  hasManagedFlag?: boolean;
};

// "none" picks a kind later, or never.
export const SELECTABLE_IMPLEMENTATION_TYPES: ImplementationType[] = [
  ...selectableImplementationTypes,
];

// Removing the last implementation keeps the chosen kind, so the card still
// offers that kind.
export function implementationTypeAfterUnlink(
  exp: ImplementationLinkages,
): ImplementationType | undefined {
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
// A Values experiment's one linked flag is its managed flag; anything beside
// it makes a mix.
export function getImplementationType(
  exp: ImplementationLinkages,
): ImplementationType | undefined {
  const stored = exp.implementationType ?? undefined;
  const derived = deriveImplementationType(exp);
  if (exp.hasManagedFlag || stored === "values") {
    const onlyItsFlag =
      !derived ||
      (derived === "feature" && (exp.linkedFeatures?.length ?? 0) <= 1);
    return onlyItsFlag ? "values" : "multi";
  }
  // Chosen, it stays a mix whatever is linked so far.
  if (stored === "multi") return "multi";
  return derived ?? stored;
}

// What a write stores: the derived type, except that "values" stays until it's
// changed on purpose, since only the flag's marker says it.
export function storedImplementationType(
  exp: ImplementationLinkages,
): ImplementationType | undefined {
  return exp.implementationType === "values"
    ? "values"
    : getImplementationType(exp);
}

// Nothing is served from its setup: marked "none", or an older experiment with
// no type and nothing linked. A holdout serves through its own rules, whatever
// is linked.
export function isAnalysisOnly(
  exp: ImplementationLinkages & { type?: ExperimentType },
): boolean {
  if (exp.type === "holdout") return false;
  const type = getImplementationType(exp);
  return !type || type === "none";
}

// Leaving Values for these converts its flag, which stays linked; anything
// else deletes it.
export function keepsManagedFlag(next: ImplementationType): boolean {
  return next === "feature" || next === "multi";
}

// Locked while anything is linked, except to the label the linkages already
// imply, or to a mix, which holds anything.
export function canChangeImplementationType(
  exp: ImplementationLinkages,
  next: ImplementationType,
): boolean {
  if (next === "multi" || !hasImplementationLinkages(exp)) return true;
  return next === deriveImplementationType(exp);
}
