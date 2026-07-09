// Webhook payload schemas for saved-group revision events (`savedGroup.revision.*`).
// Modeled on feature-revision-notifications.ts. The base shape is the API
// revision projection, but the JSON-Patch–typed fields (`proposedChanges` and
// the activity-log snapshots) are loosened: the strict versions use
// `z.discriminatedUnion` / `z.unknown()`, which the docs generator
// (@ephys/zod-to-ts) cannot render. The loose versions are supersets, so the
// emitted payload (a full ApiSavedGroupRevision) still validates.

import { z } from "zod";
import { apiSavedGroupRevisionValidator } from "./saved-group-revisions";

// Reviewer identity, shared by approve/request-changes/comment events.
// Mirrors the `reviewer` shape used by feature revision notifications.
const reviewer = z
  .object({
    id: z.string().optional(),
    name: z.string().optional(),
    email: z.string().optional(),
  })
  .strict();

// Doc-friendly replacements for the JSON-Patch–typed fields. `.passthrough()`
// keeps them as supersets so the real (strictly-typed) values still validate.
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

// Base revision webhook payload: the API projection with the doc-incompatible
// fields swapped for loose, render-safe versions.
const savedGroupRevisionWebhookPayload = apiSavedGroupRevisionValidator.extend({
  proposedChanges: webhookProposedChanges,
  activityLog: webhookActivityLog,
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
  savedGroupRevisionWebhookPayload;
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
  savedGroupRevisionWebhookPayload
    .extend({
      reviewer,
      reviewComment: z.string().nullable(),
    })
    .strict();
export type SavedGroupRevisionApprovedPayload = z.infer<
  typeof savedGroupRevisionApprovedPayload
>;

export const savedGroupRevisionChangesRequestedPayload =
  savedGroupRevisionWebhookPayload
    .extend({
      reviewer,
      reviewComment: z.string().nullable(),
    })
    .strict();
export type SavedGroupRevisionChangesRequestedPayload = z.infer<
  typeof savedGroupRevisionChangesRequestedPayload
>;

export const savedGroupRevisionCommentedPayload =
  savedGroupRevisionWebhookPayload
    .extend({
      reviewer,
      reviewComment: z.string(),
    })
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
    })
    .strict();
export type SavedGroupRevisionRevertedPayload = z.infer<
  typeof savedGroupRevisionRevertedPayload
>;
