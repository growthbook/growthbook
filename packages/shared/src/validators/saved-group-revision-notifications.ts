// Webhook payload schemas for saved-group revision events (`savedGroup.revision.*`).
// Modeled on feature-revision-notifications.ts. The base shape is the existing
// API revision projection (`apiSavedGroupRevisionValidator`); event-specific
// variants extend it with the extra fields each event carries.

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

// Events with no extra fields reuse the base revision projection directly.
export const savedGroupRevisionCreatedPayload = apiSavedGroupRevisionValidator;
export type SavedGroupRevisionCreatedPayload = z.infer<
  typeof savedGroupRevisionCreatedPayload
>;

export const savedGroupRevisionReviewRequestedPayload =
  apiSavedGroupRevisionValidator;
export type SavedGroupRevisionReviewRequestedPayload = z.infer<
  typeof savedGroupRevisionReviewRequestedPayload
>;

export const savedGroupRevisionRebasedPayload = apiSavedGroupRevisionValidator;
export type SavedGroupRevisionRebasedPayload = z.infer<
  typeof savedGroupRevisionRebasedPayload
>;

export const savedGroupRevisionPublishedPayload =
  apiSavedGroupRevisionValidator;
export type SavedGroupRevisionPublishedPayload = z.infer<
  typeof savedGroupRevisionPublishedPayload
>;

export const savedGroupRevisionDiscardedPayload =
  apiSavedGroupRevisionValidator;
export type SavedGroupRevisionDiscardedPayload = z.infer<
  typeof savedGroupRevisionDiscardedPayload
>;

export const savedGroupRevisionReopenedPayload = apiSavedGroupRevisionValidator;
export type SavedGroupRevisionReopenedPayload = z.infer<
  typeof savedGroupRevisionReopenedPayload
>;

// `change` indicates which kind of saved-group field was mutated. Derived from
// the revision's proposed-changes patch op paths when the event is dispatched.
export const savedGroupRevisionUpdatedPayload = apiSavedGroupRevisionValidator
  .extend({
    change: z.enum(["metadata", "condition", "values", "archive"]),
  })
  .strict();
export type SavedGroupRevisionUpdatedPayload = z.infer<
  typeof savedGroupRevisionUpdatedPayload
>;

export const savedGroupRevisionApprovedPayload = apiSavedGroupRevisionValidator
  .extend({
    reviewer,
    reviewComment: z.string().nullable(),
  })
  .strict();
export type SavedGroupRevisionApprovedPayload = z.infer<
  typeof savedGroupRevisionApprovedPayload
>;

export const savedGroupRevisionChangesRequestedPayload =
  apiSavedGroupRevisionValidator
    .extend({
      reviewer,
      reviewComment: z.string().nullable(),
    })
    .strict();
export type SavedGroupRevisionChangesRequestedPayload = z.infer<
  typeof savedGroupRevisionChangesRequestedPayload
>;

export const savedGroupRevisionCommentedPayload = apiSavedGroupRevisionValidator
  .extend({
    reviewer,
    reviewComment: z.string(),
  })
  .strict();
export type SavedGroupRevisionCommentedPayload = z.infer<
  typeof savedGroupRevisionCommentedPayload
>;

export const savedGroupRevisionRevertedPayload = apiSavedGroupRevisionValidator
  .extend({
    // The version that was reverted *to*, when it can be resolved from the
    // source revision. Optional because the revert is keyed by revision id.
    revertedToVersion: z.number().int().optional(),
  })
  .strict();
export type SavedGroupRevisionRevertedPayload = z.infer<
  typeof savedGroupRevisionRevertedPayload
>;
