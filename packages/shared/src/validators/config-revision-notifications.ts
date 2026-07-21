// Webhook payload schemas for config revision events (`config.revision.*`).
// Modeled on constant-revision-notifications.ts. The base shape is the API
// revision projection, but the JSON-Patch–typed fields (`proposedChanges` and
// the activity-log snapshots) are loosened to render-safe supersets so the docs
// generator can emit them.

import { z } from "zod";
import { apiConfigRevisionValidator } from "./config-revisions";
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

const configRevisionWebhookPayload = apiConfigRevisionValidator.extend({
  proposedChanges: webhookProposedChanges,
  activityLog: webhookActivityLog,
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

export const configRevisionPublishedPayload = configRevisionWebhookPayload;
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
  .extend({ reviewer, reviewComment: z.string().nullable() })
  .strict();
export type ConfigRevisionApprovedPayload = z.infer<
  typeof configRevisionApprovedPayload
>;

export const configRevisionChangesRequestedPayload =
  configRevisionWebhookPayload
    .extend({ reviewer, reviewComment: z.string().nullable() })
    .strict();
export type ConfigRevisionChangesRequestedPayload = z.infer<
  typeof configRevisionChangesRequestedPayload
>;

export const configRevisionCommentedPayload = configRevisionWebhookPayload
  .extend({ reviewer, reviewComment: z.string() })
  .strict();
export type ConfigRevisionCommentedPayload = z.infer<
  typeof configRevisionCommentedPayload
>;

export const configRevisionRevertedPayload = configRevisionWebhookPayload
  .extend({ revertedToVersion: z.number().int().optional() })
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
