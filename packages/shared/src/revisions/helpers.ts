import isEqual from "lodash/isEqual";
import type { ApprovalFlowConfigurations } from "shared/types/organization";
import type { TeamInterface } from "shared/types/team";
import type {
  RevisionTargetType,
  Revision,
  RevisionEntity,
  Conflict,
  MergeResult,
  JsonPatchOperation,
} from "../validators/revisions";

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
  approvalFlowSettings: _approvalFlowSettings,
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
  if (entityType === "saved-group") {
    // For saved groups: anyone who can edit can review (except the author, checked above)
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
      .find((op) => op.path === path && (op.op === "replace" || op.op === "add"));
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
  return Array.isArray(proposedChanges) ? (proposedChanges as JsonPatchOperation[]) : [];
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
    if (val1 == null) return false;
    if (val2 == null) return true;
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
