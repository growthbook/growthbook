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
  // Remove MongoDB's _id field but keep everything else including organization

  const { _id, ...rest } = savedGroup as SavedGroupInterface & {
    _id?: unknown;
  };
  return {
    ...rest,
    values: savedGroup.values ?? undefined,
    condition: savedGroup.condition ?? undefined,
    attributeKey: savedGroup.attributeKey ?? undefined,
    description: savedGroup.description ?? undefined,
    projects: savedGroup.projects ?? undefined,
    useEmptyListGroup: savedGroup.useEmptyListGroup ?? undefined,
  };
}

/**
 * Clean proposed changes by converting null values to undefined for Zod validation.
 */
function cleanProposedChanges(
  changes: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(changes).map(([key, value]) => [
      key,
      value === null ? undefined : value,
    ]),
  );
}

/**
 * Create a new revision or update an existing open one for the current user.
 * Centralizes the create-or-update pattern used by all saved-group mutation endpoints.
 * @param replaceChanges If true, replace proposed changes entirely instead of merging
 * @param forceCreate If true, always create a new revision (don't update existing)
 * @param title Optional title for the revision
 * @param revertedFrom Optional ID of the revision this is reverting
 * @param revisionId Optional specific revision ID to update (instead of finding by author)
 */
export async function createOrUpdateSavedGroupRevision(
  context: ReqContext | ApiReqContext,
  savedGroup: SavedGroupInterface,
  proposedChanges: Record<string, unknown>,
  replaceChanges = false,
  forceCreate = false,
  title?: string,
  revertedFrom?: string,
  revisionId?: string,
): Promise<Revision> {
  // Clean proposed changes to convert null to undefined
  const cleanedChanges = cleanProposedChanges(proposedChanges);

  // If updating a specific revision by ID, use that
  if (revisionId && !forceCreate) {
    const targetRevision = await context.models.revisions.getById(revisionId);
    if (targetRevision) {
      const finalChanges = replaceChanges
        ? cleanedChanges
        : cleanProposedChanges({
            ...targetRevision.target.proposedChanges,
            ...cleanedChanges,
          });

      const result = await context.models.revisions.updateProposedChanges(
        targetRevision.id,
        finalChanges,
        context.userId,
      );

      return result;
    }
  }

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
        ? cleanedChanges
        : cleanProposedChanges({
            ...existingRevision.target.proposedChanges,
            ...cleanedChanges,
          });

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
    proposedChanges: cleanedChanges,
    title,
    revertedFrom,
  });
}
