import type { Context } from "back-end/src/models/BaseModel";
import { getContextForUserIdInOrg } from "back-end/src/services/organizations";

// Armed revisions publish as the armer, so the approver only needs review authority.
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

// Recheck the armer's authority before committing approval.
export async function isArmedWithAuthorizedPublisher(
  context: Context,
  revision: Parameters<typeof armedPublisherId>[0],
  stillHoldsPublishAuthority: (
    publisherContext: Context,
  ) => boolean | Promise<boolean>,
): Promise<boolean> {
  const id = armedPublisherId(revision);
  if (!id) return false;
  const publisherContext = await getContextForUserIdInOrg(context.org, id, {
    applyProjectRestrictions: false,
  });
  if (!publisherContext) return false;
  return !!(await stillHoldsPublishAuthority(publisherContext));
}
