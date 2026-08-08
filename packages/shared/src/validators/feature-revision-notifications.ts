import { z } from "zod";
import { featureRevisionWebhookPayload } from "./feature-webhook-schemas";
import {
  bulkPublishIdField,
  revisionPublishFailedExtension,
} from "./revision-publish-failed";

export const featureRevisionCreatedPayload =
  featureRevisionWebhookPayload.strict();
export type FeatureRevisionCreatedPayload = z.infer<
  typeof featureRevisionCreatedPayload
>;

export const featureRevisionUpdatedPayload = featureRevisionWebhookPayload
  .extend({
    // What kind of mutation occurred. Useful for filtering noisy integrations.
    change: z.enum([
      "rule.add",
      "rule.update",
      "rule.delete",
      "rule.reorder",
      "rule.rampSchedule.set",
      "rule.rampSchedule.remove",
      "toggle",
      "defaultValue",
      "prerequisites",
      "holdout",
      "archive",
      "metadata",
    ]),
    // Environments touched (empty for feature-scoped changes like defaultValue/metadata).
    environments: z.array(z.string()).optional(),
  })
  .strict();
export type FeatureRevisionUpdatedPayload = z.infer<
  typeof featureRevisionUpdatedPayload
>;

// `reviewComment` is the reviewer's prose; `comment` is the revision's own saved comment.
export const featureRevisionReviewRequestedPayload =
  featureRevisionWebhookPayload
    .extend({
      reviewComment: z.string().nullable(),
    })
    .strict();
export type FeatureRevisionReviewRequestedPayload = z.infer<
  typeof featureRevisionReviewRequestedPayload
>;

// Reviewer identity, shared by approve/request-changes/comment events.
const reviewer = z
  .object({
    id: z.string().optional(),
    name: z.string().optional(),
    email: z.string().optional(),
  })
  .strict();

export const featureRevisionReviewApprovedPayload =
  featureRevisionWebhookPayload
    .extend({
      reviewer,
      reviewComment: z.string().nullable(),
    })
    .strict();
export type FeatureRevisionReviewApprovedPayload = z.infer<
  typeof featureRevisionReviewApprovedPayload
>;

export const featureRevisionChangesRequestedPayload =
  featureRevisionWebhookPayload
    .extend({
      reviewer,
      reviewComment: z.string().nullable(),
    })
    .strict();
export type FeatureRevisionChangesRequestedPayload = z.infer<
  typeof featureRevisionChangesRequestedPayload
>;

export const featureRevisionCommentedPayload = featureRevisionWebhookPayload
  .extend({
    reviewer,
    reviewComment: z.string(),
  })
  .strict();
export type FeatureRevisionCommentedPayload = z.infer<
  typeof featureRevisionCommentedPayload
>;

export const featureRevisionDiscardedPayload =
  featureRevisionWebhookPayload.strict();
export type FeatureRevisionDiscardedPayload = z.infer<
  typeof featureRevisionDiscardedPayload
>;

export const featureRevisionReopenedPayload =
  featureRevisionWebhookPayload.strict();
export type FeatureRevisionReopenedPayload = z.infer<
  typeof featureRevisionReopenedPayload
>;

// Recall returns a revision from the REVIEW cycle to draft. Distinct from
// `reopened`, which restores a DISCARDED revision — the two leave the revision in
// the same status but mean opposite things to a consumer (one retracts a review
// request, the other revives abandoned work), and recall additionally clears every
// verdict and disarms any deferred publish.
export const featureRevisionRecalledPayload =
  featureRevisionWebhookPayload.strict();
export type FeatureRevisionRecalledPayload = z.infer<
  typeof featureRevisionRecalledPayload
>;

// A review verdict RETRACTED by the reviewer who gave it. The revision's content is
// untouched; only the standing verdicts change, and the status is recomputed from
// whatever remains. The other revision families got this event while Feature Flags —
// which has its own revision engine — kept dispatching nothing at all for the same
// action.
export const featureRevisionReviewRetractedPayload =
  featureRevisionWebhookPayload.strict();
export type FeatureRevisionReviewRetractedPayload = z.infer<
  typeof featureRevisionReviewRetractedPayload
>;

// A deferred publish ARMED, re-armed, or CANCELLED. Content is untouched.
export const featureRevisionPublishScheduleChangedPayload =
  featureRevisionWebhookPayload.strict();
export type FeatureRevisionPublishScheduleChangedPayload = z.infer<
  typeof featureRevisionPublishScheduleChangedPayload
>;

export const featureRevisionRebasedPayload =
  featureRevisionWebhookPayload.strict();
export type FeatureRevisionRebasedPayload = z.infer<
  typeof featureRevisionRebasedPayload
>;

export const featureRevisionPublishedPayload = featureRevisionWebhookPayload
  .extend({ bulkPublishId: bulkPublishIdField })
  .strict();
export type FeatureRevisionPublishedPayload = z.infer<
  typeof featureRevisionPublishedPayload
>;

export const featureRevisionRevertedPayload = featureRevisionWebhookPayload
  .extend({
    // The version that was reverted *to* (source of truth for the new published state).
    revertedToVersion: z.number().int(),
    bulkPublishId: bulkPublishIdField,
  })
  .strict();
export type FeatureRevisionRevertedPayload = z.infer<
  typeof featureRevisionRevertedPayload
>;

export const featureRevisionPublishFailedPayload = featureRevisionWebhookPayload
  .extend(revisionPublishFailedExtension)
  .strict();
export type FeatureRevisionPublishFailedPayload = z.infer<
  typeof featureRevisionPublishFailedPayload
>;
