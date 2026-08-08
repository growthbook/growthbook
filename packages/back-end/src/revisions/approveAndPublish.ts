import type { Context } from "back-end/src/models/BaseModel";
import { getContextForUserIdInOrg } from "back-end/src/services/organizations";
// Who may take the combined "approve and publish" action, and whether the
// publish runs as the approver.
//
// Approving always needs review authority. The publish normally needs publish
// authority too — but not when the revision is already **armed** for
// auto-publish: there the publish was authorized by whoever armed it, and this
// approver is only the trigger. Denying them would be meaningless anyway, since
// plain Approve fires the same publish through `maybeAutoPublishRevision`.
//
// An armed approver without publish authority must NOT publish inline — that
// would run as them and fail the publish check downstream. They approve, and the
// armed fire publishes under the armer's context, which is exactly what the REST
// submit-review endpoint already does.
export type ApproveAndPublishPlan =
  | { allowed: false }
  | { allowed: true; publishInline: boolean };

export function planApproveAndPublish({
  armed,
  canReview,
  canPublish,
}: {
  /** Revision carries autoPublishOnApproval AND a resolvable armer. */
  armed: boolean;
  canReview: boolean;
  canPublish: boolean;
}): ApproveAndPublishPlan {
  if (!canReview) return { allowed: false };
  if (canPublish) return { allowed: true, publishInline: true };
  if (armed) return { allowed: true, publishInline: false };
  return { allowed: false };
}

// The identity a deferred publish would run as, or null when the revision names
// none. Callers resolve it BEFORE committing an approval, so a revision armed by
// someone who has since left is refused up front rather than half-applied.
function armedPublisherId(revision: {
  autoPublishOnApproval?: boolean;
  autoPublishEnabledBy?: string | null;
  authorId?: string;
  createdBy?: { id?: string } | null;
}): string | null {
  if (!revision.autoPublishOnApproval) return null;
  return (
    revision.autoPublishEnabledBy ||
    revision.authorId ||
    revision.createdBy?.id ||
    null
  );
}

// Armed AND still publishable: the armed waiver skips the approver's own publish
// check on the grounds that whoever armed it held the authority, so it must not
// apply when that identity no longer resolves — or no longer holds the authority
// the waiver is standing in for. Membership alone was not enough: a revoked role
// left the approval committing while the waiver hid the missing authority, and the
// deferred publish then failed silently afterwards.
//
// The authority question is entity-shaped, so the caller supplies it — evaluated in
// the ARMER's context, since they are who the publish will run as.
export async function isArmedWithAuthorizedPublisher(
  context: Context,
  revision: Parameters<typeof armedPublisherId>[0],
  stillHoldsPublishAuthority: (
    publisherContext: Context,
  ) => boolean | Promise<boolean>,
): Promise<boolean> {
  const id = armedPublisherId(revision);
  if (!id) return false;
  const publisherContext = await getContextForUserIdInOrg(context.org, id);
  if (!publisherContext) return false;
  return !!(await stillHoldsPublishAuthority(publisherContext as Context));
}
