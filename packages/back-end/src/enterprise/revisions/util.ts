import { Revision, RevisionTargetType } from "shared/enterprise";
import { SavedGroupInterface } from "shared/types/saved-group";
import { ReqContext } from "back-end/types/request";
import { ApiReqContext } from "back-end/types/api";

export function isRevisionRequired(
  context: ReqContext | ApiReqContext,
  resourceType: RevisionTargetType,
  _resourceId: string, // TODO: Future proofing?
): boolean {
  if (resourceType === "saved-group") {
    return context.org.settings?.approvalFlows?.savedGroups?.required || false;
  }
  return false;
}

/**
 * Build a clean snapshot of a saved group for use in revision targets.
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
 * Create a new revision or update an existing open one for the current user.
 * Centralizes the create-or-update pattern used by all saved-group mutation endpoints.
 * @param replaceChanges If true, replace proposed changes entirely instead of merging
 * @param forceCreate If true, always create a new revision (don't update existing)
 * @param title Optional title for the revision
 * @param revertedFrom Optional ID of the revision this is reverting
 */
export async function createOrUpdateSavedGroupRevision(
  context: ReqContext | ApiReqContext,
  savedGroup: SavedGroupInterface,
  proposedChanges: Record<string, unknown>,
  replaceChanges = false,
  forceCreate = false,
  title?: string,
  revertedFrom?: string,
): Promise<Revision> {
  // If forceCreate is true, skip checking for existing revisions
  if (!forceCreate) {
    const existingRevision =
      await context.models.revisions.getOpenByTargetAndAuthor(
        "saved-group",
        savedGroup.id,
        context.userId,
      );
    if (existingRevision) {
      const finalChanges = replaceChanges
        ? proposedChanges
        : { ...existingRevision.target.proposedChanges, ...proposedChanges };

      const result = await context.models.revisions.updateProposedChanges(
        existingRevision.id,
        finalChanges,
        context.userId,
      );

      return result;
    }
  }

  return context.models.revisions.createRequest({
    type: "saved-group",
    id: savedGroup.id,
    snapshot: buildSavedGroupSnapshot(savedGroup),
    proposedChanges,
    title,
    revertedFrom,
  });
}
