// Webhook payload schemas for SDK Connection revision events
// (`sdkConnection.revision.*`): the revision with its before, after, patch and
// review history, plus each event's own fields.

import { z } from "zod";
import {
  bulkPublishIdField,
  revisionPublishFailedExtension,
} from "./revision-publish-failed";
import {
  revisionWebhookReference,
  revisionWebhookReview,
  webhookProposedChanges,
} from "./revision-webhook-reference";
import { sdkWebhookSnapshotValidator } from "./sdk-connections";
import { apiSdkConnectionRevisionValidator } from "./sdk-connection-revisions";

// An event never carries a webhook's headers.
const sdkConnectionRevisionWebhooks = z.array(
  sdkWebhookSnapshotValidator.omit({ headers: true }).strict(),
);

const sdkConnectionRevisionWebhookPayload = revisionWebhookReference.extend({
  sdkConnection: z.object({ id: z.string(), name: z.string() }),
  ...apiSdkConnectionRevisionValidator.pick({
    baseSdkConnection: true,
    proposedSdkConnection: true,
  }).shape,
  baseSdkWebhooks: sdkConnectionRevisionWebhooks.describe(
    "The webhooks when the revision was created, without their headers",
  ),
  proposedSdkWebhooks: sdkConnectionRevisionWebhooks.describe(
    "The webhooks with this revision's changes applied, without their headers",
  ),
  proposedChanges: webhookProposedChanges,
  ...apiSdkConnectionRevisionValidator.pick({
    contributors: true,
    revertedFrom: true,
    reviews: true,
    resolution: true,
  }).shape,
});

export const sdkConnectionRevisionCreatedPayload =
  sdkConnectionRevisionWebhookPayload;
export type SdkConnectionRevisionCreatedPayload = z.infer<
  typeof sdkConnectionRevisionCreatedPayload
>;

export const sdkConnectionRevisionReviewRequestedPayload =
  sdkConnectionRevisionWebhookPayload;
export type SdkConnectionRevisionReviewRequestedPayload = z.infer<
  typeof sdkConnectionRevisionReviewRequestedPayload
>;

export const sdkConnectionRevisionRebasedPayload =
  sdkConnectionRevisionWebhookPayload;
export type SdkConnectionRevisionRebasedPayload = z.infer<
  typeof sdkConnectionRevisionRebasedPayload
>;

export const sdkConnectionRevisionPublishedPayload =
  sdkConnectionRevisionWebhookPayload
    .extend({ bulkPublishId: bulkPublishIdField })
    .strict();
export type SdkConnectionRevisionPublishedPayload = z.infer<
  typeof sdkConnectionRevisionPublishedPayload
>;

export const sdkConnectionRevisionDiscardedPayload =
  sdkConnectionRevisionWebhookPayload;
export type SdkConnectionRevisionDiscardedPayload = z.infer<
  typeof sdkConnectionRevisionDiscardedPayload
>;

export const sdkConnectionRevisionReopenedPayload =
  sdkConnectionRevisionWebhookPayload;
export type SdkConnectionRevisionReopenedPayload = z.infer<
  typeof sdkConnectionRevisionReopenedPayload
>;

export const sdkConnectionRevisionRecalledPayload =
  sdkConnectionRevisionWebhookPayload;
export type SdkConnectionRevisionRecalledPayload = z.infer<
  typeof sdkConnectionRevisionRecalledPayload
>;

export const sdkConnectionRevisionReviewRetractedPayload =
  sdkConnectionRevisionWebhookPayload;
export type SdkConnectionRevisionReviewRetractedPayload = z.infer<
  typeof sdkConnectionRevisionReviewRetractedPayload
>;

export const sdkConnectionRevisionPublishScheduleChangedPayload =
  sdkConnectionRevisionWebhookPayload;
export type SdkConnectionRevisionPublishScheduleChangedPayload = z.infer<
  typeof sdkConnectionRevisionPublishScheduleChangedPayload
>;

// `change` indicates which part of the SDK Connection was mutated, derived from
// the revision's proposed changes when the event is dispatched.
export const sdkConnectionRevisionUpdatedPayload =
  sdkConnectionRevisionWebhookPayload
    .extend({
      change: z.enum(["settings", "webhooks", "archive"]),
    })
    .strict();
export type SdkConnectionRevisionUpdatedPayload = z.infer<
  typeof sdkConnectionRevisionUpdatedPayload
>;

export const sdkConnectionRevisionApprovedPayload =
  sdkConnectionRevisionWebhookPayload.extend(revisionWebhookReview).strict();
export type SdkConnectionRevisionApprovedPayload = z.infer<
  typeof sdkConnectionRevisionApprovedPayload
>;

export const sdkConnectionRevisionChangesRequestedPayload =
  sdkConnectionRevisionWebhookPayload.extend(revisionWebhookReview).strict();
export type SdkConnectionRevisionChangesRequestedPayload = z.infer<
  typeof sdkConnectionRevisionChangesRequestedPayload
>;

export const sdkConnectionRevisionCommentedPayload =
  sdkConnectionRevisionWebhookPayload
    .extend({ ...revisionWebhookReview, reviewComment: z.string() })
    .strict();
export type SdkConnectionRevisionCommentedPayload = z.infer<
  typeof sdkConnectionRevisionCommentedPayload
>;

export const sdkConnectionRevisionRevertedPayload =
  sdkConnectionRevisionWebhookPayload
    .extend({
      revertedToVersion: z.number().int().optional(),
      bulkPublishId: bulkPublishIdField,
    })
    .strict();
export type SdkConnectionRevisionRevertedPayload = z.infer<
  typeof sdkConnectionRevisionRevertedPayload
>;

export const sdkConnectionRevisionPublishFailedPayload =
  sdkConnectionRevisionWebhookPayload
    .extend(revisionPublishFailedExtension)
    .strict();
export type SdkConnectionRevisionPublishFailedPayload = z.infer<
  typeof sdkConnectionRevisionPublishFailedPayload
>;
