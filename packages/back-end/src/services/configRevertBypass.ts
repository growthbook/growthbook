import { Revision, RevisionTargetType } from "shared/enterprise";

// A revert-based auto-publish may skip required review only when the referenced
// revision is a genuine, already-merged revision of THIS entity. `revertedFrom`
// is a caller-supplied query string, so without this check any autoPublish
// request could name an arbitrary id (or another entity's revision) to launder
// an unrelated change past review. Shared by the config and constant controllers.
export function isValidRevertBypass({
  revision,
  entityType,
  entityId,
  revertsBypassApproval,
}: {
  revision: Revision | null;
  entityType: RevisionTargetType;
  entityId: string;
  revertsBypassApproval: boolean;
}): boolean {
  if (!revertsBypassApproval) return false;
  if (!revision) return false;
  if (revision.status !== "merged") return false;
  if (revision.target.type !== entityType) return false;
  if (revision.target.id !== entityId) return false;
  return true;
}
