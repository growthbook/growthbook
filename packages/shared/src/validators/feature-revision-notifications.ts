import { z } from "zod";
import { featureRevisionWebhookPayload } from "./feature-webhook-schemas";

// Fields present on every revision event payload.
const baseRevisionEventFields = {
  orgId: z.string(),
};

export const featureRevisionCreatedPayload = featureRevisionWebhookPayload
  .extend(baseRevisionEventFields)
  .strict();
export type FeatureRevisionCreatedPayload = z.infer<
  typeof featureRevisionCreatedPayload
>;

export const featureRevisionUpdatedPayload = featureRevisionWebhookPayload
  .extend({
    ...baseRevisionEventFields,
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
      ...baseRevisionEventFields,
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
      ...baseRevisionEventFields,
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
      ...baseRevisionEventFields,
      reviewer,
      reviewComment: z.string().nullable(),
    })
    .strict();
export type FeatureRevisionChangesRequestedPayload = z.infer<
  typeof featureRevisionChangesRequestedPayload
>;

export const featureRevisionCommentedPayload = featureRevisionWebhookPayload
  .extend({
    ...baseRevisionEventFields,
    reviewer,
    reviewComment: z.string(),
  })
  .strict();
export type FeatureRevisionCommentedPayload = z.infer<
  typeof featureRevisionCommentedPayload
>;

export const featureRevisionDiscardedPayload = featureRevisionWebhookPayload
  .extend(baseRevisionEventFields)
  .strict();
export type FeatureRevisionDiscardedPayload = z.infer<
  typeof featureRevisionDiscardedPayload
>;

export const featureRevisionRebasedPayload = featureRevisionWebhookPayload
  .extend(baseRevisionEventFields)
  .strict();
export type FeatureRevisionRebasedPayload = z.infer<
  typeof featureRevisionRebasedPayload
>;

export const featureRevisionPublishedPayload = featureRevisionWebhookPayload
  .extend(baseRevisionEventFields)
  .strict();
export type FeatureRevisionPublishedPayload = z.infer<
  typeof featureRevisionPublishedPayload
>;

export const featureRevisionRevertedPayload = featureRevisionWebhookPayload
  .extend({
    ...baseRevisionEventFields,
    // The version that was reverted *to* (source of truth for the new published state).
    revertedToVersion: z.number().int(),
  })
  .strict();
export type FeatureRevisionRevertedPayload = z.infer<
  typeof featureRevisionRevertedPayload
>;
