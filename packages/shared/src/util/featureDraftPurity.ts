import { isEqual } from "lodash";
import type { RevisionMetadata } from "shared/validators";
import type { FeatureRevisionInterface } from "shared/types/feature-revision";
import type { FeatureInterface, FeatureRule } from "shared/types/feature";
// Specific file, not the barrel, to avoid a runtime import cycle.
import { normalizeProposedChanges } from "../revisions/helpers";
import {
  MergeResultChanges,
  featureMetadataEnvelope,
  getEffectiveRevisionHoldout,
  normalizeMetadataValue,
} from "./features";

/**
 * "Is this draft purely an X?" — what a narrow atom asks before acting on a
 * draft it didn't author. Revert authority may move one that only restores a
 * published revision; delete authority, one that only archives the flag.
 *
 * Shared because the client decides what to offer and the server decides what
 * to allow: a disagreement is a button that fails.
 */

// Plain content: restoring these puts back a value that was already live.
// `rules`, `environmentsEnabled` and `metadata` are handled separately.
const CONTENT_FIELDS = ["defaultValue", "prerequisites", "archived"] as const;

// Fields `buildEffectiveDraft` inherits from live when the draft omits them, so
// an omission proposes nothing rather than proposing `undefined`.
const INHERITED_WHEN_ABSENT = new Set<(typeof CONTENT_FIELDS)[number]>([
  "prerequisites",
  "archived",
]);

// Effects reaching beyond this feature: never restorable, only left untouched.
type SideEffectField = "holdout";

// Every publishable field must be classified as content or side effect: adding
// one to MergeResultChanges without deciding which fails the build.
type UnclassifiedMergeField = Exclude<
  keyof MergeResultChanges,
  | (typeof CONTENT_FIELDS)[number]
  | SideEffectField
  | "rules"
  | "environmentsEnabled"
  | "metadata"
>;
const _allMergeFieldsClassified: UnclassifiedMergeField extends never
  ? true
  : never = true;
void _allMergeFieldsClassified;

/**
 * Whether an `archived` value flips the flag out of service. Only this
 * direction is delete-class; unarchiving returns a flag to service and is
 * publish-class.
 */
export function isArchiveTransition({
  proposed,
  current,
}: {
  proposed: boolean | undefined;
  current: boolean | undefined;
}): boolean {
  return proposed === true && !current;
}

/**
 * Whether the draft moves the flag's holdout membership. Holdout is stored
 * sparsely, so absence inherits the live value rather than clearing it —
 * `getEffectiveRevisionHoldout` is the one place that rule is written down.
 */
function holdoutChanges({
  feature,
  draft,
}: {
  feature: FeatureInterface;
  draft: FeatureRevisionInterface;
}): boolean {
  return !isEqual(
    getEffectiveRevisionHoldout(draft, feature),
    feature.holdout ?? null,
  );
}

function plausibleRules(rules: unknown): FeatureRule[] {
  return ((rules ?? []) as FeatureRule[]).filter(
    (r) => r != null && typeof r === "object" && !Array.isArray(r),
  );
}

function liveValueFor(
  field: (typeof CONTENT_FIELDS)[number],
  feature: FeatureInterface,
): unknown {
  switch (field) {
    case "defaultValue":
      return feature.defaultValue;
    case "prerequisites":
      return feature.prerequisites ?? [];
    case "archived":
      return feature.archived ?? false;
  }
}

/**
 * `metadata` is a sparse patch, not an envelope: absent inherits live, present
 * keys overlay it. Only the keys the draft carries can differ, and comparing
 * the whole object would read every draft as impure the moment either side
 * spelled an absent field differently.
 */
function metadataMatches(
  proposed: RevisionMetadata | undefined,
  against: RevisionMetadata | undefined,
): boolean {
  if (!proposed) return true;
  return (Object.keys(proposed) as (keyof RevisionMetadata)[]).every((k) =>
    isEqual(
      normalizeMetadataValue(k, proposed[k]),
      normalizeMetadataValue(k, against?.[k]),
    ),
  );
}

// `createRevision` writes an entry for every environment it was handed,
// defaulting absent ones to false — and the env list differs per caller.
// Compare per environment instead of whole-object, so those filled-in keys
// don't read as edits.
function environmentsEnabledOnlyRestore({
  feature,
  draft,
  target,
}: {
  feature: FeatureInterface;
  draft: FeatureRevisionInterface;
  target: FeatureRevisionInterface;
}): boolean {
  const proposed = draft.environmentsEnabled ?? {};
  const restored = target.environmentsEnabled ?? {};

  return Object.entries(proposed).every(([env, enabled]) => {
    if (env in restored) return enabled === restored[env];
    return enabled === (feature.environmentSettings?.[env]?.enabled ?? false);
  });
}

/**
 * Whether a feature draft restores `target`'s content and changes nothing else.
 *
 * Each content field must equal the target's value (a restoration) or live's (a
 * no-op). The no-op branch covers sparse legacy targets, whose unrecorded
 * envelopes `createRevision` fills from the live feature.
 *
 * `rampActions` and `holdout` must be no-ops even when the target recorded
 * something different — "restoring" them still fires a side effect beyond this
 * feature (ramp-schedule create/detach, holdout membership).
 */
export function isPureFeatureRevert({
  feature,
  draft,
  target,
}: {
  feature: FeatureInterface;
  draft: FeatureRevisionInterface;
  target: FeatureRevisionInterface;
}): boolean {
  if (draft.revertedFromVersion === undefined) return false;
  if (draft.revertedFromVersion !== target.version) return false;

  // Side effects must be no-ops — see the note above.
  if (draft.rampActions?.length) return false;
  if (holdoutChanges({ feature, draft })) return false;

  const proposedRules = plausibleRules(draft.rules);
  const rulesRestore =
    isEqual(proposedRules, plausibleRules(target.rules)) ||
    isEqual(proposedRules, plausibleRules(feature.rules));
  if (!rulesRestore) return false;

  if (!environmentsEnabledOnlyRestore({ feature, draft, target })) return false;

  if (
    !metadataMatches(draft.metadata, target.metadata) &&
    !metadataMatches(draft.metadata, featureMetadataEnvelope(feature))
  ) {
    return false;
  }

  return CONTENT_FIELDS.every((field) => {
    const proposed = draft[field];
    if (proposed === undefined && INHERITED_WHEN_ABSENT.has(field)) return true;
    if (isEqual(proposed, target[field])) return true;
    return isEqual(proposed, liveValueFor(field, feature));
  });
}

/**
 * Whether a feature draft only archives the flag and changes nothing else.
 * The delete-authority counterpart to `isPureFeatureRevert`.
 */
export function isPureFeatureArchive({
  feature,
  draft,
}: {
  feature: FeatureInterface;
  draft: FeatureRevisionInterface;
}): boolean {
  if (
    !isArchiveTransition({
      proposed: draft.archived,
      current: feature.archived,
    })
  ) {
    return false;
  }

  if (draft.rampActions?.length) return false;
  if (holdoutChanges({ feature, draft })) return false;

  if (!isEqual(plausibleRules(draft.rules), plausibleRules(feature.rules))) {
    return false;
  }

  const proposedEnvs = draft.environmentsEnabled ?? {};
  const envsUnchanged = Object.entries(proposedEnvs).every(
    ([env, enabled]) =>
      enabled === (feature.environmentSettings?.[env]?.enabled ?? false),
  );
  if (!envsUnchanged) return false;

  if (!metadataMatches(draft.metadata, featureMetadataEnvelope(feature)))
    return false;

  return CONTENT_FIELDS.filter((field) => field !== "archived").every(
    (field) =>
      (draft[field] === undefined && INHERITED_WHEN_ABSENT.has(field)) ||
      isEqual(draft[field], liveValueFor(field, feature)),
  );
}

/**
 * The `archived` value a JSON-patch change set would land, or undefined when it
 * doesn't touch the field. Later ops win, matching patch application order.
 */
export function proposedArchivedValue(
  proposedChanges: unknown,
): boolean | undefined {
  let value: boolean | undefined;
  for (const op of normalizeProposedChanges(proposedChanges)) {
    if (op.path !== "/archived") continue;
    if (op.op !== "replace" && op.op !== "add") continue;
    if (typeof op.value === "boolean") value = op.value;
  }
  return value;
}

/**
 * The entity-generic twin of `isPureFeatureArchive`. Feature drafts carry typed
 * fields; every other entity carries JSON Patch ops, so purity is "every op
 * sets `archived`, and the result is an archive transition".
 */
export function isPureArchiveRevision({
  proposedChanges,
  current,
}: {
  proposedChanges: unknown;
  current: boolean | undefined;
}): boolean {
  const ops = normalizeProposedChanges(proposedChanges);
  if (!ops.length) return false;

  const onlyArchiveOps = ops.every(
    (op) =>
      op.path === "/archived" &&
      (op.op === "replace" || op.op === "add") &&
      typeof op.value === "boolean",
  );
  if (!onlyArchiveOps) return false;

  return isArchiveTransition({
    proposed: proposedArchivedValue(ops),
    current,
  });
}
