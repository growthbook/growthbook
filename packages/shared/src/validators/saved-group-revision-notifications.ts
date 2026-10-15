// Webhook payload schemas for savedGroup revision events (`savedGroup.revision.*`):
// a reference to the revision plus each event's own fields.

import { z } from "zod";
import {
  bulkPublishIdField,
  revisionPublishFailedExtension,
} from "./revision-publish-failed";
import {
  revisionWebhookReference,
  revisionWebhookReview,
} from "./revision-webhook-reference";

const savedGroupRevisionWebhookPayload = revisionWebhookReference.extend({
  savedGroup: z.object({ id: z.string(), name: z.string() }),
});

// Events with no extra fields reuse the base revision payload directly.
export const savedGroupRevisionCreatedPayload =
  savedGroupRevisionWebhookPayload;
export type SavedGroupRevisionCreatedPayload = z.infer<
  typeof savedGroupRevisionCreatedPayload
>;

export const savedGroupRevisionReviewRequestedPayload =
  savedGroupRevisionWebhookPayload;
export type SavedGroupRevisionReviewRequestedPayload = z.infer<
  typeof savedGroupRevisionReviewRequestedPayload
>;

export const savedGroupRevisionRebasedPayload =
  savedGroupRevisionWebhookPayload;
export type SavedGroupRevisionRebasedPayload = z.infer<
  typeof savedGroupRevisionRebasedPayload
>;

export const savedGroupRevisionPublishedPayload =
  savedGroupRevisionWebhookPayload
    .extend({ bulkPublishId: bulkPublishIdField })
    .strict();
export type SavedGroupRevisionPublishedPayload = z.infer<
  typeof savedGroupRevisionPublishedPayload
>;

export const savedGroupRevisionDiscardedPayload =
  savedGroupRevisionWebhookPayload;
export type SavedGroupRevisionDiscardedPayload = z.infer<
  typeof savedGroupRevisionDiscardedPayload
>;

export const savedGroupRevisionReopenedPayload =
  savedGroupRevisionWebhookPayload;
export type SavedGroupRevisionReopenedPayload = z.infer<
  typeof savedGroupRevisionReopenedPayload
>;

export const savedGroupRevisionRecalledPayload =
  savedGroupRevisionWebhookPayload;
export type SavedGroupRevisionRecalledPayload = z.infer<
  typeof savedGroupRevisionRecalledPayload
>;

export const savedGroupRevisionReviewRetractedPayload =
  savedGroupRevisionWebhookPayload;
export type SavedGroupRevisionReviewRetractedPayload = z.infer<
  typeof savedGroupRevisionReviewRetractedPayload
>;

export const savedGroupRevisionPublishScheduleChangedPayload =
  savedGroupRevisionWebhookPayload;
export type SavedGroupRevisionPublishScheduleChangedPayload = z.infer<
  typeof savedGroupRevisionPublishScheduleChangedPayload
>;

// `change` indicates which kind of saved-group field was mutated. Derived from
// the revision's proposed-changes patch op paths when the event is dispatched.
export const savedGroupRevisionUpdatedPayload = savedGroupRevisionWebhookPayload
  .extend({
    change: z.enum(["metadata", "condition", "values", "archive"]),
  })
  .strict();
export type SavedGroupRevisionUpdatedPayload = z.infer<
  typeof savedGroupRevisionUpdatedPayload
>;

export const savedGroupRevisionApprovedPayload =
  savedGroupRevisionWebhookPayload.extend(revisionWebhookReview).strict();
export type SavedGroupRevisionApprovedPayload = z.infer<
  typeof savedGroupRevisionApprovedPayload
>;

export const savedGroupRevisionChangesRequestedPayload =
  savedGroupRevisionWebhookPayload.extend(revisionWebhookReview).strict();
export type SavedGroupRevisionChangesRequestedPayload = z.infer<
  typeof savedGroupRevisionChangesRequestedPayload
>;

export const savedGroupRevisionCommentedPayload =
  savedGroupRevisionWebhookPayload
    .extend({ ...revisionWebhookReview, reviewComment: z.string() })
    .strict();
export type SavedGroupRevisionCommentedPayload = z.infer<
  typeof savedGroupRevisionCommentedPayload
>;

export const savedGroupRevisionRevertedPayload =
  savedGroupRevisionWebhookPayload
    .extend({
      // The version that was reverted *to*, when it can be resolved from the
      // source revision. Optional because the revert is keyed by revision id.
      revertedToVersion: z.number().int().optional(),
      bulkPublishId: bulkPublishIdField,
    })
    .strict();
export type SavedGroupRevisionRevertedPayload = z.infer<
  typeof savedGroupRevisionRevertedPayload
>;

export const savedGroupRevisionPublishFailedPayload =
  savedGroupRevisionWebhookPayload
    .extend(revisionPublishFailedExtension)
    .strict();
export type SavedGroupRevisionPublishFailedPayload = z.infer<
  typeof savedGroupRevisionPublishFailedPayload
>;
