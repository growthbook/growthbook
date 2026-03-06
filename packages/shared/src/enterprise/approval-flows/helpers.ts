import isEqual from "lodash/isEqual";
import type { ApprovalFlowConfigurations } from "shared/types/organization";
import type { TeamInterface } from "shared/types/team";
import type {
  ApprovalFlowTargetType,
  ApprovalFlow,
  ApprovalFlowEntity,
  Conflict,
  MergeResult,
} from "../validators/approval-flows";

/**
 * Map entity types to a key used for logging/identification.
 */
export const getApprovalFlowKey = (
  entityType: ApprovalFlowTargetType,
): string | null => {
  switch (entityType) {
    case "saved-group":
      return "saved-groups";
    default:
      return null;
  }
};

/**
 * Check if a user can review (approve/request-changes) an approval flow.
 *
 * For saved-group: anyone who can edit can review (except the author)
 * For managedBy: "team" → user must be on teamOwner team (and not the author)
 * For managedBy: "admin" → user must have manageOfficialResources (and not the author)
 */
export const canUserReviewEntity = ({
  entityType,
  approvalFlow,
  entity,
  approvalFlowSettings: _approvalFlowSettings,
  userId,
  teams,
  userPermissions,
  canEditEntity,
}: {
  entityType: ApprovalFlowTargetType;
  approvalFlow: ApprovalFlow;
  entity: ApprovalFlowEntity | Record<string, unknown>;
  approvalFlowSettings: ApprovalFlowConfigurations | undefined;
  userId: string;
  teams?: TeamInterface[];
  userPermissions?: Record<string, boolean>;
  canEditEntity?: boolean;
}): boolean => {
  // Can't review merged/closed flows or own changes
  if (
    approvalFlow.status === "merged" ||
    approvalFlow.status === "closed" ||
    approvalFlow.authorId === userId
  ) {
    return false;
  }

  if (entityType === "saved-group") {
    // For saved groups: anyone who can edit can review (except the author, checked above)
    return !!canEditEntity;
  }

  // Legacy team/admin logic for other entity types (FactMetric, FactTable)
  const typedEntity = entity as ApprovalFlowEntity;
  const proposedManagedBy = (
    approvalFlow.target.proposedChanges as Record<string, unknown>
  )?.managedBy as string | undefined;
  const managedBy = proposedManagedBy ?? typedEntity.managedBy;
  const proposedOwnerTeam = (
    approvalFlow.target.proposedChanges as Record<string, unknown>
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
 * Unchanged from previous implementation.
 */
export function checkMergeConflicts(
  baseState: Record<string, unknown>,
  liveState: Record<string, unknown>,
  proposedChanges: Record<string, unknown>,
): MergeResult {
  const conflicts: Conflict[] = [];
  const fieldsChanged: string[] = [];
  const mergedChanges: Record<string, unknown> = { ...liveState };

  for (const field of Object.keys(proposedChanges)) {
    const baseValue = baseState[field];
    const liveValue = liveState[field];
    const proposedValue = proposedChanges[field];

    const liveChanged = !isEqual(baseValue, liveValue);
    const proposedChanged = !isEqual(baseValue, proposedValue);

    if (liveChanged && proposedChanged) {
      if (!isEqual(liveValue, proposedValue)) {
        conflicts.push({ field, baseValue, liveValue, proposedValue });
      } else {
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
