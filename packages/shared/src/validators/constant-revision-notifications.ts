// Webhook payload schemas for constant revision events (`constant.revision.*`): the
// revision with its before, after, patch and review history, plus each event's
// own fields.

import { z } from "zod";
import {
  bulkPublishIdField,
  revisionPublishFailedExtension,
} from "./revision-publish-failed";
import {
  keyedEntityReference,
  revisionWebhookReference,
  revisionWebhookReview,
  webhookProposedChanges,
} from "./revision-webhook-reference";
import { apiConstantValidator } from "./constant";
import { apiConstantRevisionValidator } from "./constant-revisions";

const constantRevisionWebhookPayload = revisionWebhookReference.extend({
  constant: keyedEntityReference,
  baseConstant: apiConstantValidator,
  proposedConstant: apiConstantValidator,
  proposedChanges: webhookProposedChanges,
  ...apiConstantRevisionValidator.pick({
    contributors: true,
    revertedFrom: true,
    reviews: true,
    resolution: true,
  }).shape,
});

export const constantRevisionCreatedPayload = constantRevisionWebhookPayload;
export type ConstantRevisionCreatedPayload = z.infer<
  typeof constantRevisionCreatedPayload
>;

export const constantRevisionReviewRequestedPayload =
  constantRevisionWebhookPayload;
export type ConstantRevisionReviewRequestedPayload = z.infer<
  typeof constantRevisionReviewRequestedPayload
>;

export const constantRevisionRebasedPayload = constantRevisionWebhookPayload;
export type ConstantRevisionRebasedPayload = z.infer<
  typeof constantRevisionRebasedPayload
>;

export const constantRevisionPublishedPayload = constantRevisionWebhookPayload
  .extend({ bulkPublishId: bulkPublishIdField })
  .strict();
export type ConstantRevisionPublishedPayload = z.infer<
  typeof constantRevisionPublishedPayload
>;

export const constantRevisionDiscardedPayload = constantRevisionWebhookPayload;
export type ConstantRevisionDiscardedPayload = z.infer<
  typeof constantRevisionDiscardedPayload
>;

export const constantRevisionReopenedPayload = constantRevisionWebhookPayload;
export type ConstantRevisionReopenedPayload = z.infer<
  typeof constantRevisionReopenedPayload
>;

export const constantRevisionRecalledPayload = constantRevisionWebhookPayload;
export type ConstantRevisionRecalledPayload = z.infer<
  typeof constantRevisionRecalledPayload
>;

export const constantRevisionReviewRetractedPayload =
  constantRevisionWebhookPayload;
export type ConstantRevisionReviewRetractedPayload = z.infer<
  typeof constantRevisionReviewRetractedPayload
>;

export const constantRevisionPublishScheduleChangedPayload =
  constantRevisionWebhookPayload;
export type ConstantRevisionPublishScheduleChangedPayload = z.infer<
  typeof constantRevisionPublishScheduleChangedPayload
>;

// `change` indicates which kind of constant field was mutated, derived from the
// revision's proposed-changes patch op paths when the event is dispatched.
export const constantRevisionUpdatedPayload = constantRevisionWebhookPayload
  .extend({
    change: z.enum(["metadata", "value", "archive"]),
  })
  .strict();
export type ConstantRevisionUpdatedPayload = z.infer<
  typeof constantRevisionUpdatedPayload
>;

export const constantRevisionApprovedPayload = constantRevisionWebhookPayload
  .extend(revisionWebhookReview)
  .strict();
export type ConstantRevisionApprovedPayload = z.infer<
  typeof constantRevisionApprovedPayload
>;

export const constantRevisionChangesRequestedPayload =
  constantRevisionWebhookPayload.extend(revisionWebhookReview).strict();
export type ConstantRevisionChangesRequestedPayload = z.infer<
  typeof constantRevisionChangesRequestedPayload
>;

export const constantRevisionCommentedPayload = constantRevisionWebhookPayload
  .extend({ ...revisionWebhookReview, reviewComment: z.string() })
  .strict();
export type ConstantRevisionCommentedPayload = z.infer<
  typeof constantRevisionCommentedPayload
>;

export const constantRevisionRevertedPayload = constantRevisionWebhookPayload
  .extend({
    revertedToVersion: z.number().int().optional(),
    bulkPublishId: bulkPublishIdField,
  })
  .strict();
export type ConstantRevisionRevertedPayload = z.infer<
  typeof constantRevisionRevertedPayload
>;

export const constantRevisionPublishFailedPayload =
  constantRevisionWebhookPayload
    .extend(revisionPublishFailedExtension)
    .strict();
export type ConstantRevisionPublishFailedPayload = z.infer<
  typeof constantRevisionPublishFailedPayload
>;
