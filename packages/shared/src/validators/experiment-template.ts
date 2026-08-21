import { z } from "zod";
import { statsEngines, MAX_DESCRIPTION_LENGTH } from "shared/constants";
import { customMetricSlice } from "./experiments";
import { featurePrerequisite, savedGroupTargeting } from "./shared";
import { apiBaseSchema, baseSchema } from "./base-model";
import { ownerEmailField, ownerField } from "./owner-field";

import { namedSchema } from "./openapi-helpers";

// Groups an exposure query id with its chosen identifier type. Replaces the
// deprecated flat exposureQueryId/exposureQueryIdentifierType fields.
const apiExposureQueryRef = z.object({
  id: z.string(),
  identifierType: z.string(),
});

export const experimentTemplateInterface = baseSchema
  .safeExtend({
    project: z.string().optional(),
    owner: ownerField,

    templateMetadata: z.object({
      name: z.string(),
      description: z.string().max(MAX_DESCRIPTION_LENGTH).optional(),
    }),

    type: z.enum(["standard"]),
    hypothesis: z.string().optional(),
    description: z.string().max(MAX_DESCRIPTION_LENGTH).optional(),
    tags: z.array(z.string()).optional(),
    customFields: z.record(z.string(), z.string()).optional(),

    datasource: z.string(),
    exposureQueryId: z.string(),
    exposureQueryIdentifierType: z.string().optional(),

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
      description: z.string().max(MAX_DESCRIPTION_LENGTH).optional(),
    }),

    type: z.enum(["standard"]),
    hypothesis: z.string().optional(),
    description: z.string().max(MAX_DESCRIPTION_LENGTH).optional(),
    tags: z.array(z.string()).optional(),
    customFields: z.record(z.string(), z.string()).optional(),

    datasource: z.string(),
    exposureQuery: apiExposureQueryRef.optional(),
    /** @deprecated use exposureQuery.id */
    exposureQueryId: z.string().meta({ deprecated: true }),
    /** @deprecated use exposureQuery.identifierType */
    exposureQueryIdentifierType: z
      .string()
      .optional()
      .meta({ deprecated: true }),

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
    description: z.string().max(MAX_DESCRIPTION_LENGTH).optional(),
  }),

  type: z.enum(["standard"]),
  hypothesis: z.string().optional(),
  description: z.string().max(MAX_DESCRIPTION_LENGTH).optional(),
  tags: z.array(z.string()).optional(),
  customFields: z.record(z.string(), z.string()).optional(),

  datasource: z.string(),
  exposureQuery: apiExposureQueryRef
    .describe(
      "The exposure query to use, grouping its ID with the identifier type analyzed on. Mutually exclusive with the deprecated exposureQueryId/exposureQueryIdentifierType.",
    )
    .optional(),
  /** @deprecated use exposureQuery.id */
  exposureQueryId: z
    .string()
    .describe("Deprecated: use exposureQuery instead.")
    .optional()
    .meta({ deprecated: true }),
  /** @deprecated use exposureQuery.identifierType */
  exposureQueryIdentifierType: z
    .string()
    .describe("Deprecated: use exposureQuery.identifierType instead.")
    .optional()
    .meta({ deprecated: true }),

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
