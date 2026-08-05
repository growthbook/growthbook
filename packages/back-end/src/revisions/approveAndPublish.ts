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

/** Whether a revision is armed such that approving it will publish on its own. */
export function isArmedForAutoPublish(revision: {
  autoPublishOnApproval?: boolean;
  autoPublishEnabledBy?: string;
  authorId?: string;
  // Feature revisions record their author as `createdBy` rather than
  // `authorId`. Reading only `authorId` made a legacy armed feature revision
  // look unarmed, so an approver was asked for publish authority the armed fire
  // does not need.
  createdBy?: { id?: string } | null;
}): boolean {
  if (!revision.autoPublishOnApproval) return false;
  // The fire path falls back to the author when `autoPublishEnabledBy` predates
  // the field, so either identity is enough to run the publish as someone who
  // held the authority.
  return !!(
    revision.autoPublishEnabledBy ||
    revision.authorId ||
    revision.createdBy?.id
  );
}
