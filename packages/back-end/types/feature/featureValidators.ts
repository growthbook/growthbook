import * as z from "zod";
import { vUserRef } from "../user/userValidators";

export const vFeatureValueType = z.union([
  z.literal("boolean"),
  z.literal("string"),
  z.literal("number"),
  z.literal("json"),
]);

export const vBaseRule = z.object({
  id: z.string(),
  description: z.string(),
  condition: z
    .string()
    .and(z.custom((v) => JSON.parse(v as string)))
    .optional(),
  enabled: z.boolean().optional(),
});

export const vForceRule = vBaseRule.extend({
  type: z.literal("force"),
  value: z.string(),
});

export const vRolloutRule = vBaseRule.extend({
  type: z.literal("rollout"),
  value: z.string(),
  coverage: z.number().min(0).max(1),
  hashAttribute: z.string(),
});

export const vExperimentValue = z.object({
  value: z.string(),
  weight: z.number().min(0).max(1),
  name: z.string().optional(),
});
export const vNamespaceValue = z.object({
  enabled: z.boolean(),
  name: z.string(),
  range: z.array(z.number()).length(2),
});
export const vExperimentRule = vBaseRule.extend({
  type: z.literal("experiment"),
  trackingKey: z.string(),
  hashAttribute: z.string(),
  values: z.array(vExperimentValue),
  namespace: vNamespaceValue.optional(),
  coverage: z.number().min(0).max(1).optional(),
});
export const vFeatureRule = z.union([
  vForceRule,
  vRolloutRule,
  vExperimentRule,
]);

export const vFeatureEnvironment = z.object({
  enabled: z.boolean(),
  rules: z.array(vFeatureRule),
});

export const vFeatureDraftChanges = z.object({
  active: z.boolean(),
  dateCreated: z.date().optional(),
  dateUpdated: z.date().optional(),
  defaultValue: z.string().optional(),
  rules: z.record(z.string(), z.array(vFeatureRule)).optional(),
  comment: z.string().optional(),
});

export const vFeatureRevisionInterface = z.object({
  version: z.number(),
  comment: z.string(),
  date: z.date(),
  publishedBy: vUserRef,
});

export const vFeatureInterface = z.object({
  id: z.string().and(z.custom((id: string) => id.match(/^[a-zA-Z0-9_.:|-]+$/))),
  archived: z.boolean().optional(),
  description: z.string().optional(),
  organization: z.string(),
  owner: z.string(),
  project: z.string().optional(),
  dateCreated: z.date(),
  dateUpdated: z.date(),
  valueType: vFeatureValueType,
  defaultValue: z.string(),
  tags: z.array(z.string()).optional(),
  environmentSettings: z.record(z.string(), vFeatureEnvironment).optional(),
  draft: vFeatureDraftChanges.optional(),
  revision: vFeatureRevisionInterface.optional(),
});

export const vCreateFeatureInterface = z.object({
  id: z.string().and(z.custom((id: string) => id.match(/^[a-zA-Z0-9_.:|-]+$/))),
  archived: z.boolean().optional(),
  description: z.string().optional(),
  owner: z.string().optional(),
  project: z.string().optional(),
  valueType: vFeatureValueType,
  defaultValue: z.string(),
  tags: z.array(z.string()).optional(),
  environmentSettings: z
    .record(
      z.string(),
      z.object({
        enabled: z.boolean(),
        rules: z.array(vFeatureRule),
      })
    )
    .optional(),
  draft: vFeatureDraftChanges.optional(),
  revision: vFeatureRevisionInterface.optional(),
});

export const vUpdateFeatureInterface = z.object({
  description: z.string().optional(),
  owner: z.string().optional(),
  project: z.string().optional(),
  tags: z.array(z.string()).optional(),
  archived: z.boolean().optional(),
});
