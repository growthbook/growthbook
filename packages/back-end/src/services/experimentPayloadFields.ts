import isEqual from "lodash/isEqual";
import type { ExperimentInterface } from "shared/types/experiment";
import type { InterleavingInterface } from "shared/validators";
import { interleavingInSDKPayload } from "shared/util";

// The experiment fields that reach SDK payloads, so changing one changes what
// a live experiment serves.
export const PAYLOAD_AFFECTING_EXPERIMENT_FIELDS: (keyof ExperimentInterface)[] =
  [
    "phases",
    "variations",
    "project",
    "name",
    "trackingKey",
    "archived",
    "status",
    "releasedVariationId",
    "excludeFromPayload",
    "type",
    "banditStage",
    "banditStageDateStarted",
    "banditScheduleValue",
    "banditScheduleUnit",
    "banditBurnInValue",
    "banditBurnInUnit",
    // Bucketing fields. They end up in the SDK payload, so changing
    // bucketVersion re-buckets every user.
    "hashAttribute",
    "fallbackAttribute",
    "hashVersion",
    "disableStickyBucketing",
    "bucketVersion",
    "minBucketVersion",
  ];

// The interleaving fields that reach SDK payloads, so changing one changes what
// a live interleaving serves. Deliberately not the same set as
// INTERLEAVING_FIELD_ACTIONS in services/confirmations.ts: that maps fields to
// confirmation actions and treats `archived` as inert, while archiving removes
// the pseudo flag from the payload.
export const PAYLOAD_AFFECTING_INTERLEAVING_FIELDS: (keyof InterleavingInterface)[] =
  [
    "variations",
    "coverage",
    "condition",
    "savedGroups",
    "prerequisites",
    "seed",
    "hashAttribute",
    "trackingKey",
    "key",
    "project",
    "archived",
    "status",
    "environmentSettings",
  ];

export function payloadAffectingInterleavingChanges(
  existing: InterleavingInterface,
  changes?: Partial<InterleavingInterface>,
): (keyof InterleavingInterface)[] {
  if (!changes) return [];
  return PAYLOAD_AFFECTING_INTERLEAVING_FIELDS.filter(
    (field) => field in changes && !isEqual(changes[field], existing[field]),
  );
}

// Live payload changes require the same permission as starting.
export function interleavingUpdateNeedsRunPermission(
  existing: InterleavingInterface,
  updated?: Partial<InterleavingInterface>,
): boolean {
  if (!updated) return false;
  const statusChanged =
    updated.status !== undefined && updated.status !== existing.status;
  const envsChanged =
    updated.environmentSettings !== undefined &&
    !isEqual(updated.environmentSettings, existing.environmentSettings);
  const servesNow =
    (interleavingInSDKPayload(existing) ||
      interleavingInSDKPayload({ ...existing, ...updated })) &&
    payloadAffectingInterleavingChanges(existing, updated).length > 0;
  return statusChanged || envsChanged || servesNow;
}
