import { z } from "zod";
import {
  featureEnvironment,
  featureRule,
  featureValueType,
  JSONSchemaDef,
} from "./features";

const clipboardJSONSchemaDef = JSONSchemaDef.extend({
  date: z.preprocess(
    (value) => (typeof value === "string" ? new Date(value) : value),
    z.date(),
  ),
});

export const growthbookClipboardMetadata = z
  .object({
    source: z.literal("growthbook"),
    object: z.literal("feature"),
    // Accept any positive integer version. Field-level validation below will
    // catch any structural incompatibility from a future envelope rather than
    // silently rejecting the entire paste with no feedback.
    version: z.number().int().min(1),
    exportedAt: z.string().optional(),
  })
  .strict();

// Source-org context for a single reference (experiment, saved group, etc.).
// `name` (and `details` when present) are shown in the import-time reference
// mapping UI so a user can identify what the original referred to.
export const growthbookClipboardReferenceContext = z
  .object({
    id: z.string(),
    name: z.string().optional(),
    details: z.string().optional(),
  })
  .strict();

export type GrowthBookClipboardReferenceContext = z.infer<
  typeof growthbookClipboardReferenceContext
>;

export const growthbookFeatureClipboardReferences = z
  .object({
    experiments: z.array(growthbookClipboardReferenceContext),
    savedGroups: z.array(growthbookClipboardReferenceContext),
    safeRollouts: z.array(growthbookClipboardReferenceContext),
    features: z.array(growthbookClipboardReferenceContext),
    environments: z.array(growthbookClipboardReferenceContext),
  })
  .strict();

export type GrowthBookFeatureClipboardReferences = z.infer<
  typeof growthbookFeatureClipboardReferences
>;

export const growthbookFeatureClipboardFeature = z
  .object({
    id: z.string(),
    description: z.string().optional(),
    project: z.string().optional(),
    valueType: z.enum(featureValueType),
    defaultValue: z.string(),
    tags: z.array(z.string()).optional(),
    environmentSettings: z.record(z.string(), featureEnvironment).optional(),
    rules: z.array(featureRule),
    customFields: z.record(z.string(), z.any()).optional(),
    jsonSchema: clipboardJSONSchemaDef.optional(),
    neverStale: z.boolean().optional(),
  })
  .strict();

export const growthbookFeatureClipboardPayload = z
  .object({
    growthbook: growthbookClipboardMetadata,
    feature: growthbookFeatureClipboardFeature,
    references: growthbookFeatureClipboardReferences,
  })
  .strict();

export const growthbookClipboardPayload = z.union([
  growthbookFeatureClipboardPayload,
]);

export type GrowthBookFeatureClipboardFeature = z.infer<
  typeof growthbookFeatureClipboardFeature
>;

export type GrowthBookFeatureClipboardPayload = z.infer<
  typeof growthbookFeatureClipboardPayload
>;
