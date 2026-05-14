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
    version: z.literal(1),
    exportedAt: z.string().optional(),
  })
  .strict();

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
