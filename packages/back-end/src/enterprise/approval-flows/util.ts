import { ApprovalFlow, ApprovalFlowTargetType } from "shared/enterprise";
import { SavedGroupInterface } from "shared/types/saved-group";
import { ReqContext } from "back-end/types/request";
import { ApiReqContext } from "back-end/types/api";
import { ApprovalFlowModel } from "back-end/src/enterprise/models/ApprovalFlowModel";

export function isApprovalFlowRequired(
  context: ReqContext | ApiReqContext,
  resourceType: ApprovalFlowTargetType,
  _resourceId: string, // TODO: Future proofing?
): boolean {
  if (resourceType === "saved-group") {
    return context.org.settings?.approvalFlows?.savedGroups?.required || false;
  }
  return false;
}

/**
 * Throw if the given user already has an open approval flow for the target.
 * Centralizes the per-author uniqueness check for all creation paths.
 */
export async function ensureNoOpenFlowForAuthor(
  approvalFlowModel: ApprovalFlowModel,
  targetType: ApprovalFlowTargetType,
  targetId: string,
  userId: string,
): Promise<void> {
  const existing = await approvalFlowModel.getOpenByTargetAndAuthor(
    targetType,
    targetId,
    userId,
  );
  if (existing) {
    throw new Error("You already have an open approval flow for this resource");
  }
}

/**
 * Build a clean snapshot of a saved group for use in approval flow targets.
 * Converts null/undefined optional fields to undefined so they don't persist as null in MongoDB.
 */
export function buildSavedGroupSnapshot(
  savedGroup: SavedGroupInterface,
): SavedGroupInterface {
  return {
    ...savedGroup,
    values: savedGroup.values ?? undefined,
    condition: savedGroup.condition ?? undefined,
    attributeKey: savedGroup.attributeKey ?? undefined,
    description: savedGroup.description ?? undefined,
    projects: savedGroup.projects ?? undefined,
    useEmptyListGroup: savedGroup.useEmptyListGroup ?? undefined,
  };
}

/**
 * Create a new approval flow or update an existing open one for the current user.
 * Centralizes the create-or-update pattern used by all saved-group mutation endpoints.
 */
export async function createOrUpdateSavedGroupApprovalFlow(
  context: ReqContext | ApiReqContext,
  savedGroup: SavedGroupInterface,
  proposedChanges: Record<string, unknown>,
): Promise<ApprovalFlow> {
  const existingFlow =
    await context.models.approvalFlows.getOpenByTargetAndAuthor(
      "saved-group",
      savedGroup.id,
      context.userId,
    );

  if (existingFlow) {
    return context.models.approvalFlows.updateProposedChanges(
      existingFlow.id,
      { ...existingFlow.target.proposedChanges, ...proposedChanges },
      context.userId,
    );
  }

  return context.models.approvalFlows.createRequest({
    type: "saved-group",
    id: savedGroup.id,
    snapshot: buildSavedGroupSnapshot(savedGroup),
    proposedChanges,
  });
}
