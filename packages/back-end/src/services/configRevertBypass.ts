import { isEqual } from "lodash";
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

// Validating the `revertedFrom` id isn't enough: the applied change set comes
// from the caller's body, so a valid revision id could otherwise front arbitrary
// values past review. This confirms the changes genuinely RESTORE the target
// revision — every changed field's post-change snapshot value must equal the
// target snapshot's value for that field. Checked per changed field (not the
// whole snapshot) so a partial revert still qualifies. An optional field's falsy
// default (`false`/`null`) is treated as equivalent to absent (`undefined`) so a
// legit unarchive revert (body sends `archived:false` against a target snapshot
// that omits `archived`) isn't rejected. This can only make an EMPTY value match
// an absent one — a non-empty arbitrary value still can't impersonate a
// different target value, so no laundering is opened.
export function revertRestoresTargetSnapshot({
  changedFields,
  proposedSnapshot,
  targetSnapshot,
}: {
  changedFields: string[];
  proposedSnapshot: Record<string, unknown>;
  targetSnapshot: Record<string, unknown>;
}): boolean {
  const norm = (v: unknown): unknown =>
    v === false || v === null || v === undefined ? undefined : v;
  return changedFields.every((f) =>
    isEqual(norm(proposedSnapshot[f]), norm(targetSnapshot[f])),
  );
}
