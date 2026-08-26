import { canCommentOnRevisionEntity } from "shared/permissions";
import { ANY_REVIEW_FOOTPRINT, getReviewSetting } from "shared/util";
import { FeatureInterface } from "shared/validators";
import { EventUser } from "shared/types/events/event-types";
import { ReqContext } from "back-end/types/request";
import { BadRequestError } from "back-end/src/util/errors";
import { mayBeRevisionAuthor } from "back-end/src/revisions/revisionAuthority";
import { ApiReqContext } from "back-end/types/api";
import {
  getRevision,
  ReviewSubmittedType,
  submitReviewAndComments,
} from "back-end/src/models/FeatureRevisionModel";
import { getFeatureReviewFootprint } from "back-end/src/services/features";
import { dispatchRevisionReviewEvent } from "back-end/src/services/featureRevisionEvents";
import { maybeAutoPublishFeatureRevision } from "back-end/src/api/features/autoPublishOnApproval";

/**
 * Records a verdict or a comment on a feature revision. Extracted so the
 * internal route and the experiment's managed-flag route share one set of rules
 * — the self-approval block and the review-cycle CAS in particular.
 */
export async function submitFeatureRevisionReview({
  context,
  feature,
  version,
  review = "Comment",
  comment,
  eventAudit,
}: {
  context: ReqContext | ApiReqContext;
  feature: FeatureInterface;
  version: number;
  review?: ReviewSubmittedType;
  comment: string;
  eventAudit: EventUser;
}): Promise<void> {
  // A verdict is the review atom; a plain comment is participation, so the
  // comment atom carries it — review implies it but must not gate it. Uses the
  // shared predicate so all four entities answer identically, narrowed to the
  // primary project to match `canReviewFeatureDrafts`.
  //
  // Known structural divergence: the other three engines judge this on
  // `revision.target.snapshot`; feature revisions carry no origin snapshot
  // (`metadata.project` is the DESTINATION a draft stages), so this engine can
  // only ask about live.
  const canCommentHere = canCommentOnRevisionEntity(
    context.permissions,
    "feature",
    null,
    { project: feature.project },
  );
  if (review === "Comment" && !canCommentHere) {
    context.permissions.throwPermissionError();
  }
  // Coarse pre-fetch gate so callers without the review atom cannot probe
  // which revision versions exist; the footprint check below still runs.
  if (
    review !== "Comment" &&
    !context.permissions.canReviewFeatureDrafts(feature, ANY_REVIEW_FOOTPRINT)
  ) {
    context.permissions.throwPermissionError();
  }

  const revision = await getRevision({
    context,
    organization: context.org.id,
    featureId: feature.id,
    feature,
    version,
  });
  if (!revision) {
    throw new Error("Could not find feature revision");
  }

  // A verdict is judged against what the draft changes, so it waits on the
  // revision. Comments keep their pre-fetch refusal.
  if (review !== "Comment") {
    const footprint = await getFeatureReviewFootprint({
      context,
      feature,
      revision,
    });
    if (!context.permissions.canReviewFeatureDrafts(feature, footprint)) {
      context.permissions.throwPermissionError();
    }
  }
  // Verdicts may stand alone, but a plain comment must have a body.
  if (review === "Comment" && !comment?.trim()) {
    throw new Error("Comment cannot be empty");
  }

  // Author separation. `mayBeRevisionAuthor` rather than an id comparison so an
  // identityless principal — an API key reaching this through the experiment's
  // variation-values routes — cannot approve an authorless draft it may have
  // created itself. Identical to an id comparison whenever both sides have one.
  const creatorId =
    revision.createdBy != null && "id" in revision.createdBy
      ? revision.createdBy.id
      : "";
  if (review !== "Comment" && mayBeRevisionAuthor(creatorId, context.userId)) {
    throw new BadRequestError("Cannot submit a review on a draft you created");
  }

  // Block contributors from self-approving when the org setting is enabled.
  // Note: contributors[] is only populated on drafts created after contributor tracking was
  // deployed. Legacy drafts with no contributors[] bypass this check — there is no way to
  // retroactively determine co-authors without reading revision logs.
  const requireReviews = context.org.settings?.requireReviews;
  const blockSelfApproval = Array.isArray(requireReviews)
    ? !!getReviewSetting(requireReviews, feature)?.blockSelfApproval
    : false;
  // The early, clear refusal. Re-applied inside the verdict's CAS against the row it
  // writes, because this reads a copy the contributor list can outrun.
  if (review === "Approved" && blockSelfApproval) {
    const isSelfApproval = (revision.contributors ?? []).some(
      (id) => id === context.userId,
    );
    if (isSelfApproval) {
      throw new Error("You cannot approve a draft you contributed to.");
    }
  }
  // dont allow review unless you are adding a comment
  if (
    !(
      revision.status === "changes-requested" ||
      revision.status === "pending-review" ||
      revision.status === "approved"
    ) &&
    review !== "Comment"
  ) {
    throw new Error("Can only review if review is requested");
  }
  const { applied } = await submitReviewAndComments(
    context,
    revision,
    eventAudit,
    review,
    comment,
    // Capture the live version the approval is made against so a later publish
    // can detect when the approval has gone stale.
    feature.version,
    blockSelfApproval,
  );
  if (!applied) {
    // The verdict did not persist: a concurrent recall, discard or publish moved
    // the revision out of the review cycle. Refuse rather than log, notify and
    // report success for a review the document does not carry.
    throw new Error(
      "This revision is no longer in review — it was recalled, published or discarded while the request was in flight.",
    );
  }

  const updatedRevision = await getRevision({
    context,
    organization: context.org.id,
    featureId: feature.id,
    feature,
    version,
  });
  const finalRevision = updatedRevision ?? revision;

  const auditUser = context.auditUser;
  const reviewer =
    auditUser && auditUser.type !== "system"
      ? { id: auditUser.id, name: auditUser.name, email: auditUser.email }
      : {};

  await dispatchRevisionReviewEvent(
    context,
    feature,
    revision,
    finalRevision,
    review,
    comment,
    reviewer,
  );

  if (review === "Approved") {
    await maybeAutoPublishFeatureRevision(context, feature, finalRevision);
  }
}
