// Webhook payload schemas for feature and feature-revision events.
// Intentionally loosely typed (z.any() for nested rules/environments) — the
// strict API-response versions live in features.ts. Kept as a leaf file to
// avoid circular imports with the broader validator graph.

import { z } from "zod";
import { ownerField } from "./owner-field";

const revisionPrerequisite = z.object({
  id: z.string().describe("Feature ID"),
  condition: z.string(),
});

export const featureRevisionWebhookPayload = z
  .object({
    featureId: z.string().describe("The feature this revision belongs to"),
    baseVersion: z.number().int(),
    version: z.number().int(),
    comment: z.string(),
    date: z.string(),
    status: z.string(),
    createdBy: z.string().optional(),
    publishedBy: z.string().optional(),
    defaultValue: z
      .string()
      .describe("The default value at the time this revision was created")
      .optional(),
    // Rules are typed loosely — consumers should use the REST API for full detail.
    rules: z.record(z.string(), z.array(z.any())),
    definitions: z.record(z.string(), z.string()).optional(),
    environmentsEnabled: z.record(z.string(), z.boolean()).optional(),
    envPrerequisites: z
      .record(z.string(), z.array(revisionPrerequisite))
      .optional(),
    prerequisites: z.array(revisionPrerequisite).optional(),
    metadata: z.object({}).passthrough().optional(),
  })
  .strict();

export type FeatureRevisionWebhookPayload = z.infer<
  typeof featureRevisionWebhookPayload
>;

export const featureWebhookPayload = z
  .object({
    id: z.string(),
    dateCreated: z.string(),
    dateUpdated: z.string(),
    archived: z.boolean(),
    description: z.string(),
    owner: ownerField,
    project: z.string(),
    valueType: z.enum(["boolean", "string", "number", "json"]),
    defaultValue: z.string(),
    tags: z.array(z.string()),
    // Environment objects contain typed rules in the API schema; loose here.
    environments: z.record(z.string(), z.any()),
    prerequisites: z
      .array(z.string())
      .describe("Feature IDs. Each feature must evaluate to `true`")
      .optional(),
    revision: z.object({
      version: z.number().int(),
      comment: z.string(),
      date: z.string(),
      createdBy: z.string(),
      publishedBy: z.string(),
    }),
    customFields: z.record(z.string(), z.object({}).passthrough()).optional(),
    holdout: z
      .object({
        id: z.string().describe("Holdout ID"),
        value: z
          .string()
          .describe(
            "The feature value assigned to users in the holdout treatment group",
          ),
      })
      .nullable()
      .optional(),
  })
  .strict();

export type FeatureWebhookPayload = z.infer<typeof featureWebhookPayload>;
