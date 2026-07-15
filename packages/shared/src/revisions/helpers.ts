import isEqual from "lodash/isEqual";
import type {
  ApprovalFlowConfiguration,
  ApprovalFlowConfigurations,
  OrganizationSettings,
} from "shared/types/organization";
import type { TeamInterface } from "shared/types/team";
import type { ConstantInterface } from "shared/types/constant";
import type {
  RevisionTargetType,
  Revision,
  RevisionEntity,
  Conflict,
  MergeResult,
  JsonPatchOperation,
} from "../validators/revisions";
// Constants borrow the feature `requireReviews` model rather than the
// saved-group `approvalFlows` config, so self-approval / autopublish are read
// from there. Imported from the specific file (not the barrel) to avoid a
// runtime import cycle.
import {
  constantBlockSelfApproval,
  constantAutopublishOnApproval,
} from "../util/features";

/**
 * Resolve the approval-flow configuration for a given entity type.
 *
 * Extension point: when introducing a new RevisionTargetType, add a `case`
 * mapping it to the corresponding key on `ApprovalFlowConfigurations`.
 *
 * Returns `undefined` if no approval-flow config exists for the entity type
 * yet (treat the same as "no approval flow features enabled").
 */
export const getApprovalFlowSettings = (
  approvalFlows: ApprovalFlowConfigurations | undefined,
  entityType: RevisionTargetType,
): ApprovalFlowConfiguration | undefined => {
  if (!approvalFlows) return undefined;
  switch (entityType) {
    case "saved-group":
      return approvalFlows.savedGroups?.[0];
    // Constants don't use this config — they inherit the feature `requireReviews`
    // settings (see constantRequiresReview).
    default:
      return undefined;
  }
};

/**
 * Top-level saved-group fields that count as "metadata" for the purposes of
 * the `requireMetadataReview` gate. When the org has saved-group approval
 * enabled but metadata review disabled, revisions whose proposed changes
 * touch only these fields can be published without going through review.
 *
 * Content fields (`values`, `condition`, `attributeKey`, `useEmptyListGroup`)
 * always require full review when approval is enabled.
 */
export const SAVED_GROUP_METADATA_FIELDS: ReadonlySet<string> = new Set([
  "groupName",
  "owner",
  "description",
  "projects",
  "archived",
]);

/**
 * Returns true when every proposed change in the revision touches a
 * saved-group metadata field (per `SAVED_GROUP_METADATA_FIELDS`). An empty
 * proposed-changes list returns false — there's nothing to publish, so the
 * "metadata-only shortcut" doesn't apply.
 *
 * Used to decide whether the `requireMetadataReview` gate lets a revision
 * be merged without approval.
 */
export const isSavedGroupRevisionMetadataOnly = (
  proposedChanges: JsonPatchOperation[] | unknown,
): boolean => {
  const ops = normalizeProposedChanges(proposedChanges);
  if (ops.length === 0) return false;
  return ops.every((op) => {
    const field = op.path.split("/")[1];
    return !!field && SAVED_GROUP_METADATA_FIELDS.has(field);
  });
};

/**
 * Top-level constant fields that count as "metadata" for the `requireMetadataReview`
 * gate. The content fields (`value`, `environmentValues`) always require full
 * review when approval is enabled, since they change the value the SDK resolves.
 */
export const CONSTANT_METADATA_FIELDS: ReadonlySet<string> = new Set([
  "name",
  "owner",
  "description",
  "project",
  "archived",
]);

// Config-only fields whose change affects the value the SDK resolves (so they
// must require full review when approval is enabled, like `value`). Constants
// never carry these, so they're inert for constant revisions.
const CONFIG_CONTENT_FIELDS: ReadonlySet<string> = new Set([
  "schema",
  "parent",
  "extends",
  "extensible",
  // NOTE: `scopedOverrides` is NOT here — the env/project variant selection writes
  // immediately (setConfigScopedOverrides), never through a revision, so it's
  // never part of a revision's proposed changes.
]);

/**
 * Returns true when every proposed change in the revision touches a constant
 * metadata field (per `CONSTANT_METADATA_FIELDS`). An empty proposed-changes
 * list returns false. Mirrors `isSavedGroupRevisionMetadataOnly`.
 */
export const isConstantRevisionMetadataOnly = (
  proposedChanges: JsonPatchOperation[] | unknown,
): boolean => {
  const ops = normalizeProposedChanges(proposedChanges);
  if (ops.length === 0) return false;
  return ops.every((op) => {
    const field = op.path.split("/")[1];
    return !!field && CONSTANT_METADATA_FIELDS.has(field);
  });
};

/**
 * Derive what a constant revision changes, for approval scoping: whether the
 * generic `value` changed (affects all environments), which per-environment
 * overrides changed, and whether the change is metadata-only. Feeds
 * `constantRequiresReview`, which mirrors the feature review model.
 */
export const getConstantRevisionChange = (
  snapshot: Pick<ConstantInterface, "value" | "environmentValues">,
  proposedChanges: JsonPatchOperation[] | unknown,
): {
  valueChanged: boolean;
  changedEnvironments: string[];
  metadataOnly: boolean;
} => {
  const ops = normalizeProposedChanges(proposedChanges);
  const patched = applyTopLevelPatchOps(
    snapshot as unknown as Record<string, unknown>,
    ops,
  ) as Pick<ConstantInterface, "value" | "environmentValues">;

  // Config-only content fields that change what the SDK resolves, so they need
  // full review when approval is enabled rather than metadata-only treatment:
  // `schema` (field definitions) plus the lineage/extensibility fields, which
  // shift the effective resolved value. Constants never carry these ops, so
  // this is a no-op for them.
  const contentChanged = ops.some((op) =>
    CONFIG_CONTENT_FIELDS.has(op.path.split("/")[1]),
  );
  // Deep-equal, not `!==`: a constant's value is a string, but a config reuses
  // this helper with an OBJECT value, where reference-inequality would flag a
  // restated-but-unchanged value as a change (spuriously forcing review).
  const valueChanged =
    !isEqual(snapshot.value ?? "", patched.value ?? "") || contentChanged;

  const oldEnvs = snapshot.environmentValues ?? {};
  const newEnvs = patched.environmentValues ?? {};
  const changedEnvironments = Array.from(
    new Set([...Object.keys(oldEnvs), ...Object.keys(newEnvs)]),
  ).filter((env) => (oldEnvs[env] ?? "") !== (newEnvs[env] ?? ""));

  return {
    valueChanged,
    changedEnvironments,
    metadataOnly: isConstantRevisionMetadataOnly(ops),
  };
};

/**
 * Whether self-approval is blocked for this revision's entity, read from the
 * correct config source: constants use the feature `requireReviews` model
 * (matched on the constant's project); other entities use `approvalFlows`.
 */
const isSelfApprovalBlockedForEntity = (
  settings: OrganizationSettings | undefined,
  entityType: RevisionTargetType,
  revision: Pick<Revision, "target">,
): boolean => {
  if (entityType === "constant" || entityType === "config") {
    const snapshot = revision.target.snapshot as { project?: string };
    return constantBlockSelfApproval({ project: snapshot.project }, settings);
  }
  return !!getApprovalFlowSettings(settings?.approvalFlows, entityType)
    ?.blockSelfApproval;
};

/**
 * Returns true when `userId` contributed to the revision and the entity-type's
 * `blockSelfApproval` setting is enabled — meaning the user must NOT be allowed
 * to approve.
 *
 * Legacy revisions written before `contributors` existed fall back to
 * `[authorId]`, so the existing author-self-review guard remains the only
 * effective gate for them.
 */
export const isUserBlockedFromApproving = ({
  settings,
  entityType,
  revision,
  userId,
}: {
  settings: OrganizationSettings | undefined;
  entityType: RevisionTargetType;
  revision: Pick<Revision, "authorId" | "contributors" | "target">;
  userId: string;
}): boolean => {
  if (!isSelfApprovalBlockedForEntity(settings, entityType, revision)) {
    return false;
  }
  const contributors = revision.contributors ?? [revision.authorId];
  return contributors.includes(userId);
};

export const isAutopublishOnApprovalEnabled = (
  settings: OrganizationSettings | undefined,
  entityType: RevisionTargetType,
  // The constant's project, used to match its `requireReviews` rule. Ignored
  // for entities that read from `approvalFlows`.
  project?: string,
): boolean => {
  if (entityType === "constant" || entityType === "config") {
    return constantAutopublishOnApproval({ project }, settings);
  }
  return !!getApprovalFlowSettings(settings?.approvalFlows, entityType)
    ?.autopublishOnApproval;
};

/**
 * Map entity types to a key used for logging/identification.
 *
 * Extension point: add a new `case` here when introducing a new RevisionTargetType.
 * The return value is used as the audit-log / URL segment for the entity.
 */
export const getRevisionKey = (
  entityType: RevisionTargetType,
): string | null => {
  switch (entityType) {
    case "saved-group":
      return "saved-groups";
    case "constant":
      return "constants";
    case "config":
      return "configs";
    // case "feature": return "features";  ← add future entity types here
    default:
      return null;
  }
};

/**
 * Check if a user can review (approve/request-changes) a revision.
 *
 * For saved-group: anyone who can edit can review (except the author)
 * For managedBy: "team" → user must be on teamOwner team (and not the author)
 * For managedBy: "admin" → user must have manageOfficialResources (and not the author)
 */
export const canUserReviewEntity = ({
  entityType,
  revision,
  entity,
  userId,
  teams,
  userPermissions,
  canEditEntity,
}: {
  entityType: RevisionTargetType;
  revision: Revision;
  entity: RevisionEntity | Record<string, unknown>;
  approvalFlowSettings: ApprovalFlowConfigurations | undefined;
  userId: string;
  teams?: TeamInterface[];
  userPermissions?: Record<string, boolean>;
  canEditEntity?: boolean;
}): boolean => {
  // Can't review merged/discarded revisions or own changes
  if (
    revision.status === "merged" ||
    revision.status === "discarded" ||
    revision.authorId === userId
  ) {
    return false;
  }

  // Extension point: add a new `case` here when introducing a new RevisionTargetType
  // that requires custom reviewer logic beyond the default `canEditEntity` check.
  if (
    entityType === "saved-group" ||
    entityType === "constant" ||
    entityType === "config"
  ) {
    // Anyone who can edit can review (except the author, checked above)
    return !!canEditEntity;
  }
  // case "feature": return !!canEditEntity;  ← add future entity types here

  // Legacy team/admin logic for other entity types (FactMetric, FactTable)
  const typedEntity = entity as RevisionEntity;
  const ops = normalizeProposedChanges(revision.target.proposedChanges);
  const findOpValue = (path: string): unknown => {
    const found = ops
      .slice()
      .reverse()
      .find(
        (op) => op.path === path && (op.op === "replace" || op.op === "add"),
      );
    return found && (found.op === "replace" || found.op === "add")
      ? found.value
      : undefined;
  };
  const proposedManagedBy = findOpValue("/managedBy") as string | undefined;
  const managedBy = proposedManagedBy ?? typedEntity.managedBy;
  const proposedOwnerTeam = findOpValue("/ownerTeam") as string | undefined;
  const ownerTeamId = proposedOwnerTeam ?? typedEntity.ownerTeam;

  if (managedBy === "team") {
    if (ownerTeamId && teams) {
      const ownerTeam = teams.find((t) => t.id === ownerTeamId);
      return ownerTeam?.members?.includes(userId) ?? false;
    }
    return false;
  }

  if (managedBy === "admin") {
    return !!userPermissions?.manageOfficialResources;
  }

  return false;
};

/**
 * Normalise a `proposedChanges` value from the database.
 * Old revisions stored a plain object; new ones store a JsonPatchOperation[].
 * Always returns an array so callers don't have to guard individually.
 */
export function normalizeProposedChanges(
  proposedChanges: unknown,
): JsonPatchOperation[] {
  return Array.isArray(proposedChanges)
    ? (proposedChanges as JsonPatchOperation[])
    : [];
}

/**
 * Apply the top-level `replace` / `add` / `remove` operations from a JSON Patch
 * array to an object and return the resulting merged object.  Nested paths
 * (e.g. `/values/0`) are treated as a no-op since we only track top-level fields.
 *
 * This is intentionally a lightweight, dependency-free alternative to
 * `fast-json-patch` so it can be used in both front-end and back-end shared code.
 */
export function applyTopLevelPatchOps<T extends Record<string, unknown>>(
  snapshot: T,
  proposedChanges: JsonPatchOperation[] | unknown,
): T {
  const ops = normalizeProposedChanges(proposedChanges);
  if (ops.length === 0) return snapshot;
  const result: Record<string, unknown> = { ...snapshot };
  for (const op of ops) {
    // Only handle simple top-level paths like "/fieldName"
    const parts = op.path.split("/");
    if (parts.length !== 2 || !parts[1]) continue;
    const field = parts[1];
    if (op.op === "replace" || op.op === "add") {
      result[field] = op.value;
    } else if (op.op === "remove") {
      delete result[field];
    }
  }
  return result as T;
}

/**
 * Extract the changed fields from a JSON Patch operations array as a plain
 * partial object `{ fieldName: proposedValue }`.
 *
 * Useful when calling code that still expects `Partial<T>` (e.g. autoMerge helpers).
 * Old-format (plain object) data is returned unchanged as a Partial<T>.
 */
export function patchOpsToPartial<T extends Record<string, unknown>>(
  proposedChanges: JsonPatchOperation[] | unknown,
): Partial<T> {
  // Backward-compat: if it's already a plain object (old DB format), return as-is
  if (
    proposedChanges !== null &&
    typeof proposedChanges === "object" &&
    !Array.isArray(proposedChanges)
  ) {
    return proposedChanges as Partial<T>;
  }
  const ops = normalizeProposedChanges(proposedChanges);
  const result: Record<string, unknown> = {};
  for (const op of ops) {
    const parts = op.path.split("/");
    if (parts.length !== 2 || !parts[1]) continue;
    const field = parts[1];
    if (op.op === "replace" || op.op === "add") {
      result[field] = op.value;
    } else if (op.op === "remove") {
      result[field] = undefined;
    }
  }
  return result as Partial<T>;
}

/**
 * Check for merge conflicts on-the-fly.
 * Accepts a JSON Patch (RFC 6902) operations array representing the proposed changes.
 * Only fields that were actually changed by the user are checked.
 * If the proposed value equals the base value, it's not considered a change
 * and won't trigger a conflict even if live has changed.
 */
export function checkMergeConflicts(
  baseState: Record<string, unknown>,
  liveState: Record<string, unknown>,
  proposedChanges: JsonPatchOperation[] | unknown,
): MergeResult {
  // Normalise: old DB documents may have a plain object instead of an array
  const ops = normalizeProposedChanges(proposedChanges);

  const conflicts: Conflict[] = [];
  const fieldsChanged: string[] = [];
  const mergedChanges: Record<string, unknown> = { ...liveState };

  // Helper to check if values are different
  const hasChanged = (val1: unknown, val2: unknown): boolean => {
    if ((val1 ?? null) === null) return false;
    if ((val2 ?? null) === null) return true;
    return !isEqual(val1, val2);
  };

  // Extract the top-level field name from a JSON Pointer path (e.g. "/values" → "values",
  // "/values/0" → "values"). The leading "/" is stripped and we take the first segment.
  const fieldFromPath = (path: string): string | null => {
    const segments = path.split("/");
    return segments[1] ?? null;
  };

  // Build a map of top-level field → proposed value.
  // Later ops for the same field win (last-write wins per field).
  const proposedByField = new Map<string, unknown>();
  for (const op of ops) {
    const field = fieldFromPath(op.path);
    if (!field) continue;
    if (op.op === "replace" || op.op === "add") {
      proposedByField.set(field, op.value);
    } else if (op.op === "remove") {
      proposedByField.set(field, undefined);
    }
  }

  for (const [field, proposedValue] of proposedByField) {
    const baseValue = baseState[field];
    const liveValue = liveState[field];

    // Skip if no effective change from base
    const proposedChanged = hasChanged(proposedValue, baseValue);
    if (!proposedChanged) continue;

    const liveChanged = hasChanged(liveValue, baseValue);

    if (liveChanged && proposedChanged) {
      if (hasChanged(proposedValue, liveValue)) {
        conflicts.push({ field, baseValue, liveValue, proposedValue });
      } else {
        // Both changed to the same value — no conflict
        fieldsChanged.push(field);
      }
    } else if (proposedChanged) {
      mergedChanges[field] = proposedValue;
      fieldsChanged.push(field);
    }
  }

  return {
    success: conflicts.length === 0,
    conflicts,
    canAutoMerge: conflicts.length === 0,
    fieldsChanged,
    mergedChanges: conflicts.length === 0 ? mergedChanges : undefined,
  };
}

// ── Revision display helpers ─────────────────────────────────────────────────
// Shared by the revision dropdown, the revert modal, and the entity pages so the
// "which revision is live" rule and the display version-number fallback can't
// drift between surfaces.

const byDateCreatedAsc = <T extends Pick<Revision, "dateCreated">>(
  a: T,
  b: T,
): number =>
  new Date(a.dateCreated).getTime() - new Date(b.dateCreated).getTime();

/**
 * The "live" revision is the most-recently-published (merged) one. Returns
 * `undefined` when nothing has been published yet.
 */
export function getLiveRevision<
  T extends Pick<Revision, "status" | "dateUpdated">,
>(revisions: T[]): T | undefined {
  return [...revisions]
    .filter((r) => r.status === "merged")
    .sort(
      (a, b) =>
        new Date(b.dateUpdated).getTime() - new Date(a.dateUpdated).getTime(),
    )[0];
}

/**
 * Display version number for a single revision: the stored `version` when
 * present, otherwise its 1-based position by creation date (for legacy
 * revisions saved before `version` existed). When `revision` is undefined
 * (e.g. "live" with no published revision yet) returns the total count.
 */
export function getRevisionNumber<
  T extends Pick<Revision, "id" | "version" | "dateCreated">,
>(revisions: T[], revision: T | undefined): number {
  if ((revision?.version ?? null) !== null) return revision!.version as number;
  const sorted = [...revisions].sort(byDateCreatedAsc);
  if (revision) return sorted.findIndex((r) => r.id === revision.id) + 1;
  return sorted.length;
}

/**
 * Map of revision id → display version number (see `getRevisionNumber`).
 * Builds the creation-date sort once for the whole set.
 */
export function getRevisionNumberById<
  T extends Pick<Revision, "id" | "version" | "dateCreated">,
>(revisions: T[]): Map<string, number> {
  const sorted = [...revisions].sort(byDateCreatedAsc);
  return new Map<string, number>(
    revisions.map((r) => [
      r.id,
      r.version ?? sorted.findIndex((s) => s.id === r.id) + 1,
    ]),
  );
}
