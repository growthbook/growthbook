import { z } from "zod";
import { statsEngines } from "shared/constants";
import { customMetricSlice } from "./experiments";
import { featurePrerequisite, savedGroupTargeting } from "./shared";

export const experimentTemplateInterface = z
  .object({
    id: z.string(),
    organization: z.string(),
    project: z.string().optional(),
    owner: z.string(),
    dateCreated: z.date(),
    dateUpdated: z.date(),

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
    pinnedMetricSlices: z.array(z.string()).optional(),
  })
  .strict();
export type ExperimentTemplateInterface = z.infer<
  typeof experimentTemplateInterface
>;

export const createTemplateValidator = experimentTemplateInterface.omit({
  id: true,
  organization: true,
  owner: true,
  dateCreated: true,
  dateUpdated: true,
});
export type CreateTemplateProps = z.infer<typeof createTemplateValidator>;

export const updateTemplateValidator = experimentTemplateInterface.partial();

export type UpdateTemplateProps = z.infer<typeof updateTemplateValidator>;
