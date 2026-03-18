import isEqual from "lodash/isEqual";
import type { RevisionConfigurations } from "shared/types/organization";
import type { TeamInterface } from "shared/types/team";
import type {
  RevisionTargetType,
  Revision,
  RevisionEntity,
  Conflict,
  MergeResult,
} from "../validators/revisions";

/**
 * Map entity types to a key used for logging/identification.
 */
export const getRevisionKey = (
  entityType: RevisionTargetType,
): string | null => {
  switch (entityType) {
    case "saved-group":
      return "saved-groups";
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
  approvalFlowSettings: RevisionConfigurations | undefined;
  userId: string;
  teams?: TeamInterface[];
  userPermissions?: Record<string, boolean>;
  canEditEntity?: boolean;
}): boolean => {
  // Can't review merged/closed revisions or own changes
  if (
    revision.status === "merged" ||
    revision.status === "closed" ||
    revision.authorId === userId
  ) {
    return false;
  }

  if (entityType === "saved-group") {
    // For saved groups: anyone who can edit can review (except the author, checked above)
    return !!canEditEntity;
  }

  // Legacy team/admin logic for other entity types (FactMetric, FactTable)
  const typedEntity = entity as RevisionEntity;
  const proposedManagedBy = (
    revision.target.proposedChanges as Record<string, unknown>
  )?.managedBy as string | undefined;
  const managedBy = proposedManagedBy ?? typedEntity.managedBy;
  const proposedOwnerTeam = (
    revision.target.proposedChanges as Record<string, unknown>
  )?.ownerTeam as string | undefined;
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
 * Check for merge conflicts on-the-fly.
 * Only fields that were actually changed by the user are checked.
 * If the proposed value equals the base value, it's not considered a change
 * and won't trigger a conflict even if live has changed.
 * Treats null and undefined as equivalent when comparing.
 */
export function checkMergeConflicts(
  baseState: Record<string, unknown>,
  liveState: Record<string, unknown>,
  proposedChanges: Record<string, unknown>,
): MergeResult {
  const conflicts: Conflict[] = [];
  const fieldsChanged: string[] = [];
  const mergedChanges: Record<string, unknown> = { ...liveState };

  // Helper to check if values are different, treating null and undefined as equivalent
  const hasChanged = (val1: unknown, val2: unknown): boolean => {
    // Treat null and undefined as equivalent
    if (val1 == null && val2 == null) return false;
    return !isEqual(val1, val2);
  };

  for (const field of Object.keys(proposedChanges)) {
    const baseValue = baseState[field];
    const liveValue = liveState[field];
    const proposedValue = proposedChanges[field];

    // Check if the user actually changed this field from the base
    const proposedChanged = hasChanged(proposedValue, baseValue);

    // If the user didn't change it, skip - no conflict possible
    if (!proposedChanged) {
      continue;
    }

    // Check if live has also changed this field from the base
    const liveChanged = hasChanged(liveValue, baseValue);

    // Conflict only if both changed AND they changed to different values
    if (liveChanged && proposedChanged) {
      if (hasChanged(proposedValue, liveValue)) {
        conflicts.push({ field, baseValue, liveValue, proposedValue });
      } else {
        // Both changed to the same value - no conflict
        fieldsChanged.push(field);
      }
    } else if (proposedChanged) {
      // Only the user changed it - safe to apply
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
