import { z } from "zod";
import {
  experimentType,
  metricOverride,
  variation,
} from "back-end/src/validators/experiments";
import {
  featurePrerequisite,
  namespaceValue,
  savedGroupTargeting,
} from "back-end/src/validators/features";

export const experimentTemplateInterface = z
  .object({
    id: z.string(),
    organization: z.string(),
    projects: z.array(z.string()).default([]),
    owner: z.string(),
    dateCreated: z.date(),
    dateUpdated: z.date(),

    templateMetadata: z.object({
      name: z.string(),
      description: z.string().optional(),
      tags: z.array(z.string()),
    }),

    type: z.enum(experimentType),
    hypothesis: z.string().optional(),
    description: z.string().optional(),
    tags: z.array(z.string()),

    datasource: z.string(),
    userIdType: z.string(),
    exposureQueryId: z.string(),

    hashAttribute: z.string().optional(),
    fallbackAttribute: z.string().optional(),
    hashVersion: z.number().optional(),
    disableStickyBucketing: z.boolean().optional(),

    // Advanced
    // Add conversions windows

    goalMetrics: z.array(z.string()),
    secondaryMetrics: z.array(z.string()),
    guardrailMetrics: z.array(z.string()),
    activationMetric: z.string().optional(),
    metricOverrides: z.array(metricOverride).optional(),

    variations: z.array(variation),

    // Located in phases array for ExperimentInterface
    targeting: z.object({
      coverage: z.number(),
      savedGroups: z.array(savedGroupTargeting).optional(),
      prerequisites: z.array(featurePrerequisite).optional(),
      namespace: namespaceValue,
      groups: z.array(z.string()),
      variationWeights: z.array(z.number()),
    }),
  })
  .strict();
export type ExperimentTemplateInterface = z.infer<
  typeof experimentTemplateInterface
>;

export const createTemplateValidator = z.object({
  template: experimentTemplateInterface.strict(),
});
export type CreateTemplateProps = z.infer<typeof createTemplateValidator>;

// export const updateTemplateValidator = z.object({
//   template: experimentTemplateInterface.strict(),
// });
export type UpdateTemplateProps = z.infer<typeof experimentTemplateInterface>;
