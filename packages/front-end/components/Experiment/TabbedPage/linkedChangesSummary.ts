import { LinkedFeatureInfo } from "shared/types/experiment";
import { VisualChangesetInterface } from "shared/types/visual-changeset";
import { URLRedirectInterface } from "shared/types/url-redirect";
import { DeliveryMethod } from "./ManagedValuesContext";

// Single source of truth for "what linked changes does this experiment
// have, grouped by type." Every surface that needs this question answered
// — the Linked Changes record list/empty-state, the Change Experiment Type
// warning banner, the "no linked implementation" notice, and anything on
// the variation cards — reads from here instead of re-deriving its own
// count or flag. Two separate bugs in ChangeExperimentTypeModal traced back
// to ad hoc, drifted copies of this exact question: one read stale
// prototype state instead of live counts, the other asked "does the
// CURRENT type have records" instead of "will this transition hide any."
export type ReferenceDeliveryMethod = Exclude<DeliveryMethod, "values">;

export interface LinkedChangesSummary {
  counts: Record<ReferenceDeliveryMethod, number>;
  hasAny: boolean;
}

// Section-name labels — plural, category labels rather than counts (same
// convention as "Goal Metrics"/"Secondary Metrics" elsewhere on this page).
// The only place this text is defined; every surface that needs a type name
// (section heading, empty state, the Change Experiment Type warning banner,
// the pre-launch checklist's linked-changes item) derives it from here —
// directly for the Title Case plural form, or via the helpers below for
// other grammatical forms — rather than maintaining its own hardcoded copy.
export const LINKED_CHANGE_TYPE_LABELS: Record<
  ReferenceDeliveryMethod,
  string
> = {
  "feature-flag": "Feature Flags",
  "visual-editor": "Visual Editor Changes",
  "url-redirect": "URL Redirects",
};

// "URL" is an acronym and must stay uppercase; every other word lowercases
// normally.
function toAcronymAwareLowercase(label: string): string {
  return label
    .split(" ")
    .map((word) => (word === "URL" ? word : word.toLowerCase()))
    .join(" ");
}

// "feature flags" / "visual editor changes" / "URL redirects" — lowercase
// plural, e.g. ChangeExperimentTypeModal.tsx's "X, Y, and Z will stop
// working if you change the experiment type" sentence.
export function getLowercasePluralLabel(type: ReferenceDeliveryMethod): string {
  return toAcronymAwareLowercase(LINKED_CHANGE_TYPE_LABELS[type]);
}

// "feature flag" / "visual editor change" / "URL redirect" — lowercase
// singular, e.g. PreLaunchChecklistItems.tsx's "Add at least one X."
// linked-changes item. Every LINKED_CHANGE_TYPE_LABELS entry is a plain
// "<singular>s" plural, so stripping one trailing "s" is exact for all
// three — no irregular forms to special-case.
export function getLowercaseSingularLabel(
  type: ReferenceDeliveryMethod,
): string {
  const label = LINKED_CHANGE_TYPE_LABELS[type];
  const singular = label.endsWith("s") ? label.slice(0, -1) : label;
  return toAcronymAwareLowercase(singular);
}

export function getLinkedChangesSummary({
  linkedFeatures,
  visualChangesets,
  urlRedirects,
}: {
  linkedFeatures: LinkedFeatureInfo[];
  visualChangesets: VisualChangesetInterface[];
  urlRedirects: URLRedirectInterface[];
}): LinkedChangesSummary {
  const counts: Record<ReferenceDeliveryMethod, number> = {
    "feature-flag": linkedFeatures.length,
    "visual-editor": visualChangesets.length,
    "url-redirect": urlRedirects.length,
  };
  return {
    counts,
    hasAny:
      counts["feature-flag"] > 0 ||
      counts["visual-editor"] > 0 ||
      counts["url-redirect"] > 0,
  };
}

// Whether a given reference type's linked records are ACTIVE for the
// experiment's current delivery type — i.e. shown to the user, and safe to
// reason about elsewhere. Changing experiment type HIDES records rather
// than destroying them (that's exactly what ChangeExperimentTypeModal's
// warning banner warns about), so an experiment now on "values" can still
// hold a feature flag from before the switch. Anything deriving UI from
// those records has to ask this question first or it will surface records
// the user can't see — the pre-launch checklist was showing a "fill in
// missing variation values for <hidden flag>" item for exactly that
// reason.
//
// undefined means the caller has no delivery-type concept at all (bandits,
// holdouts, and the draft-feature-review checklist caller); those keep
// pre-type behavior and treat every type as active.
export function isLinkedChangeTypeActive(
  type: ReferenceDeliveryMethod,
  deliveryType: DeliveryMethod | undefined,
): boolean {
  return deliveryType === undefined || deliveryType === type;
}

// "Feature Flags" / "Visual Editor Changes and URL Redirects" / "Feature
// Flags, Visual Editor Changes, and URL Redirects" — used by the warning
// banner to name every type that would be hidden by a single transition,
// not just the current type.
export function joinWithAnd(items: string[]): string {
  if (items.length <= 1) return items.join("");
  if (items.length === 2) return items.join(" and ");
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}
