import { z } from "zod";
import { statsEngines } from "shared/constants";
import { customMetricSlice } from "./experiments";
import { featurePrerequisite, savedGroupTargeting } from "./shared";
import { apiBaseSchema, baseSchema } from "./base-model";
import { ownerEmailField, ownerField } from "./owner-field";

import { namedSchema } from "./openapi-helpers";

export const experimentTemplateInterface = baseSchema
  .safeExtend({
    project: z.string().optional(),
    owner: ownerField,

    templateMetadata: z.object({
      name: z.string(),
      description: z.string().optional(),
    }),

    type: z.enum(["standard"]),
    hypothesis: z.string().optional(),
    description: z.string().optional(),
    tags: z.array(z.string()).optional(),
    customFields: z.record(z.string(), z.string()).optional(),

    datasource: z.string(),
    exposureQueryId: z.string(),

    hashAttribute: z.string().optional(),
    fallbackAttribute: z.string().optional(),
    disableStickyBucketing: z.boolean().optional(),

    goalMetrics: z.array(z.string()).optional(),
    secondaryMetrics: z.array(z.string()).optional(),
    guardrailMetrics: z.array(z.string()).optional(),
    activationMetric: z.string().optional(),
    statsEngine: z.enum(statsEngines),
    segment: z.string().optional(),
    skipPartialData: z.boolean().optional(),

    // Located in phases array for ExperimentInterface
    targeting: z.object({
      coverage: z.number(),
      savedGroups: z.array(savedGroupTargeting).optional(),
      prerequisites: z.array(featurePrerequisite).optional(),
      condition: z.string(),
    }),

    customMetricSlices: z.array(customMetricSlice).optional(),
  })
  .strict();
export type ExperimentTemplateInterface = z.infer<
  typeof experimentTemplateInterface
>;

export const apiExperimentTemplateValidator = namedSchema(
  "ExperimentTemplate",
  apiBaseSchema.safeExtend({
    project: z.string().optional(),
    owner: ownerField,
    ownerEmail: ownerEmailField,

    templateMetadata: z.object({
      name: z.string(),
      description: z.string().optional(),
    }),

    type: z.enum(["standard"]),
    hypothesis: z.string().optional(),
    description: z.string().optional(),
    tags: z.array(z.string()).optional(),
    customFields: z.record(z.string(), z.string()).optional(),

    datasource: z.string(),
    exposureQueryId: z.string(),

    hashAttribute: z.string().optional(),
    fallbackAttribute: z.string().optional(),
    disableStickyBucketing: z.boolean().optional(),

    goalMetrics: z.array(z.string()).optional(),
    secondaryMetrics: z.array(z.string()).optional(),
    guardrailMetrics: z.array(z.string()).optional(),
    activationMetric: z.string().optional(),
    statsEngine: z.enum(statsEngines),
    segment: z.string().optional(),
    skipPartialData: z.boolean().optional(),

    // Located in phases array for ExperimentInterface
    targeting: z.object({
      coverage: z.number(),
      savedGroups: z.array(savedGroupTargeting).optional(),
      prerequisites: z.array(featurePrerequisite).optional(),
      condition: z.string(),
    }),

    customMetricSlices: z.array(customMetricSlice).optional(),
  }),
);

export type ApiExperimentTemplateInterface = z.infer<
  typeof apiExperimentTemplateValidator
>;

export const apiListExperimentTemplatesValidator = {
  bodySchema: z.never(),
  querySchema: z.strictObject({ projectId: z.string().optional() }),
  paramsSchema: z.never(),
};

export const apiCreateExperimentTemplateBody = z.strictObject({
  project: z.string().optional(),

  templateMetadata: z.object({
    name: z.string(),
    description: z.string().optional(),
  }),

  type: z.enum(["standard"]),
  hypothesis: z.string().optional(),
  description: z.string().optional(),
  tags: z.array(z.string()).optional(),
  customFields: z.record(z.string(), z.string()).optional(),

  datasource: z.string(),
  exposureQueryId: z.string(),

  hashAttribute: z.string().optional(),
  fallbackAttribute: z.string().optional(),
  disableStickyBucketing: z.boolean().optional(),

  goalMetrics: z.array(z.string()).optional(),
  secondaryMetrics: z.array(z.string()).optional(),
  guardrailMetrics: z.array(z.string()).optional(),
  activationMetric: z.string().optional(),
  statsEngine: z.enum(statsEngines),
  segment: z.string().optional(),
  skipPartialData: z.boolean().optional(),

  targeting: z.object({
    coverage: z.number(),
    savedGroups: z.array(savedGroupTargeting).optional(),
    prerequisites: z.array(featurePrerequisite).optional(),
    condition: z.string(),
  }),

  customMetricSlices: z.array(customMetricSlice).optional(),
});

export type ApiCreateExperimentTemplateBody = z.infer<
  typeof apiCreateExperimentTemplateBody
>;

export const apiUpdateExperimentTemplateBody =
  apiCreateExperimentTemplateBody.partial();

export type ApiUpdateExperimentTemplateBody = z.infer<
  typeof apiUpdateExperimentTemplateBody
>;

export const apiBulkImportExperimentTemplatesBody = z.strictObject({
  templates: z.array(
    z.object({
      id: z.string(),
      data: apiCreateExperimentTemplateBody,
    }),
  ),
});

export type ApiBulkImportExperimentTemplatesBody = z.infer<
  typeof apiBulkImportExperimentTemplatesBody
>;

export const apiBulkImportExperimentTemplatesResponse = z.object({
  added: z.number().int(),
  updated: z.number().int(),
});

export const createTemplateValidator = experimentTemplateInterface.omit({
  id: true,
  organization: true,
  owner: true,
  dateCreated: true,
  dateUpdated: true,
});
export type CreateTemplateProps = z.infer<typeof createTemplateValidator>;

export const updateTemplateValidator = experimentTemplateInterface
  .omit({ id: true, organization: true, dateCreated: true, dateUpdated: true })
  .partial();

export type UpdateTemplateProps = z.infer<typeof updateTemplateValidator>;
