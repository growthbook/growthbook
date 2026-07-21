// Webhook payload schemas for constant revision events (`constant.revision.*`).
// Modeled on saved-group-revision-notifications.ts. The base shape is the API
// revision projection, but the JSON-Patch–typed fields (`proposedChanges` and
// the activity-log snapshots) are loosened to render-safe supersets so the docs
// generator can emit them.

import { z } from "zod";
import { apiConstantRevisionValidator } from "./constant-revisions";
import { revisionPublishFailedExtension } from "./revision-publish-failed";

const reviewer = z
  .object({
    id: z.string().optional(),
    name: z.string().optional(),
    email: z.string().optional(),
  })
  .strict();

const webhookProposedChanges = z.array(
  z.object({ op: z.string(), path: z.string() }).passthrough(),
);
const webhookActivityLog = z.array(
  z
    .object({
      id: z.string(),
      userId: z.string(),
      action: z.string(),
      dateCreated: z.string(),
    })
    .passthrough(),
);

const constantRevisionWebhookPayload = apiConstantRevisionValidator.extend({
  proposedChanges: webhookProposedChanges,
  activityLog: webhookActivityLog,
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

export const constantRevisionPublishedPayload = constantRevisionWebhookPayload;
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
  .extend({ reviewer, reviewComment: z.string().nullable() })
  .strict();
export type ConstantRevisionApprovedPayload = z.infer<
  typeof constantRevisionApprovedPayload
>;

export const constantRevisionChangesRequestedPayload =
  constantRevisionWebhookPayload
    .extend({ reviewer, reviewComment: z.string().nullable() })
    .strict();
export type ConstantRevisionChangesRequestedPayload = z.infer<
  typeof constantRevisionChangesRequestedPayload
>;

export const constantRevisionCommentedPayload = constantRevisionWebhookPayload
  .extend({ reviewer, reviewComment: z.string() })
  .strict();
export type ConstantRevisionCommentedPayload = z.infer<
  typeof constantRevisionCommentedPayload
>;

export const constantRevisionRevertedPayload = constantRevisionWebhookPayload
  .extend({ revertedToVersion: z.number().int().optional() })
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
