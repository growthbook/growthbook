// Webhook payload schemas for config revision events (`config.revision.*`): a
// reference to the revision plus each event's own fields.

import { z } from "zod";
import {
  bulkPublishIdField,
  revisionPublishFailedExtension,
} from "./revision-publish-failed";
import {
  keyedEntityReference,
  revisionWebhookReference,
  revisionWebhookReview,
} from "./revision-webhook-reference";

const configRevisionWebhookPayload = revisionWebhookReference.extend({
  config: keyedEntityReference,
});

export const configRevisionCreatedPayload = configRevisionWebhookPayload;
export type ConfigRevisionCreatedPayload = z.infer<
  typeof configRevisionCreatedPayload
>;

export const configRevisionReviewRequestedPayload =
  configRevisionWebhookPayload;
export type ConfigRevisionReviewRequestedPayload = z.infer<
  typeof configRevisionReviewRequestedPayload
>;

export const configRevisionRebasedPayload = configRevisionWebhookPayload;
export type ConfigRevisionRebasedPayload = z.infer<
  typeof configRevisionRebasedPayload
>;

export const configRevisionPublishedPayload = configRevisionWebhookPayload
  .extend({ bulkPublishId: bulkPublishIdField })
  .strict();
export type ConfigRevisionPublishedPayload = z.infer<
  typeof configRevisionPublishedPayload
>;

export const configRevisionDiscardedPayload = configRevisionWebhookPayload;
export type ConfigRevisionDiscardedPayload = z.infer<
  typeof configRevisionDiscardedPayload
>;

export const configRevisionReopenedPayload = configRevisionWebhookPayload;
export type ConfigRevisionReopenedPayload = z.infer<
  typeof configRevisionReopenedPayload
>;

export const configRevisionRecalledPayload = configRevisionWebhookPayload;
export type ConfigRevisionRecalledPayload = z.infer<
  typeof configRevisionRecalledPayload
>;

export const configRevisionReviewRetractedPayload =
  configRevisionWebhookPayload;
export type ConfigRevisionReviewRetractedPayload = z.infer<
  typeof configRevisionReviewRetractedPayload
>;

export const configRevisionPublishScheduleChangedPayload =
  configRevisionWebhookPayload;
export type ConfigRevisionPublishScheduleChangedPayload = z.infer<
  typeof configRevisionPublishScheduleChangedPayload
>;

// `change` indicates which kind of config field was mutated, derived from the
// revision's proposed-changes patch op paths when the event is dispatched.
// Configs add a "schema" kind on top of the constant set (schema-only edits).
export const configRevisionUpdatedPayload = configRevisionWebhookPayload
  .extend({
    change: z.enum(["metadata", "value", "schema", "archive"]),
  })
  .strict();
export type ConfigRevisionUpdatedPayload = z.infer<
  typeof configRevisionUpdatedPayload
>;

export const configRevisionApprovedPayload = configRevisionWebhookPayload
  .extend(revisionWebhookReview)
  .strict();
export type ConfigRevisionApprovedPayload = z.infer<
  typeof configRevisionApprovedPayload
>;

export const configRevisionChangesRequestedPayload =
  configRevisionWebhookPayload.extend(revisionWebhookReview).strict();
export type ConfigRevisionChangesRequestedPayload = z.infer<
  typeof configRevisionChangesRequestedPayload
>;

export const configRevisionCommentedPayload = configRevisionWebhookPayload
  .extend({ ...revisionWebhookReview, reviewComment: z.string() })
  .strict();
export type ConfigRevisionCommentedPayload = z.infer<
  typeof configRevisionCommentedPayload
>;

export const configRevisionRevertedPayload = configRevisionWebhookPayload
  .extend({
    revertedToVersion: z.number().int().optional(),
    bulkPublishId: bulkPublishIdField,
  })
  .strict();
export type ConfigRevisionRevertedPayload = z.infer<
  typeof configRevisionRevertedPayload
>;

export const configRevisionPublishFailedPayload = configRevisionWebhookPayload
  .extend(revisionPublishFailedExtension)
  .strict();
export type ConfigRevisionPublishFailedPayload = z.infer<
  typeof configRevisionPublishFailedPayload
>;
