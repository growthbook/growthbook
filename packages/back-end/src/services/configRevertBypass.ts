import { Revision } from "shared/enterprise";

// A revert-based auto-publish may skip required review only when the referenced
// revision is a genuine, already-merged revision of THIS config. `revertedFrom`
// is a caller-supplied query string, so without this check any autoPublish
// request could name an arbitrary id to launder an unrelated change past review.
export function isValidRevertBypass({
  revision,
  configId,
  revertsBypassApproval,
}: {
  revision: Revision | null;
  configId: string;
  revertsBypassApproval: boolean;
}): boolean {
  if (!revertsBypassApproval) return false;
  if (!revision) return false;
  if (revision.status !== "merged") return false;
  if (revision.target.type !== "config") return false;
  if (revision.target.id !== configId) return false;
  return true;
}
