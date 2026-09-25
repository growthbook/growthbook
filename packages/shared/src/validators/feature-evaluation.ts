import { z } from "zod";
import { namedSchema } from "./openapi-helpers";

export const apiFeatureEvaluationValidator = namedSchema(
  "FeatureEvaluation",
  z
    .object({
      environment: z.string(),
      enabled: z
        .boolean()
        .describe("False when the flag is off in this environment"),
      value: z
        .unknown()
        .describe("What the SDK would return. Null when disabled."),
      source: z
        .enum([
          "unknownFeature",
          "defaultValue",
          "force",
          "override",
          "experiment",
          "prerequisite",
          "cyclicPrerequisite",
        ])
        .nullable()
        .describe("Why this value was chosen. Null when disabled."),
      ruleId: z.string().nullable().describe("The rule that matched, if any"),
      experiment: z
        .object({
          key: z.string(),
          variationId: z.number(),
          inExperiment: z.boolean(),
          hashAttribute: z.string(),
        })
        .optional()
        .describe("Present when an experiment rule matched"),
    })
    .strict(),
);

export const postFeatureEvaluateValidator = {
  bodySchema: z
    .object({
      attributes: z
        .record(z.string(), z.unknown())
        .optional()
        .describe("Merged over the archetype's attributes when both are given"),
      archetypeId: z
        .string()
        .optional()
        .describe(
          "Evaluate as this archetype (requires the archetypes feature)",
        ),
      version: z
        .number()
        .int()
        .optional()
        .describe(
          "Revision to evaluate, including unpublished drafts. Defaults to the live version.",
        ),
      environments: z
        .array(z.string())
        .optional()
        .describe("Defaults to every environment the flag is in"),
      evalDate: z.iso
        .datetime()
        .optional()
        .describe("Evaluate scheduled rules as of this time. Defaults to now."),
      skipRulesWithPrerequisites: z
        .boolean()
        .optional()
        .describe(
          "Prerequisite flags aren't evaluated here. True (default) skips rules that have them; false treats their prerequisites as passing.",
        ),
    })
    .strict(),
  querySchema: z.never(),
  paramsSchema: z.object({ id: z.string() }).strict(),
  responseSchema: z
    .object({ results: z.array(apiFeatureEvaluationValidator) })
    .strict(),
  summary: "Evaluate a feature flag for a set of attributes",
  description:
    "Runs the SDK against the flag without publishing anything, so a draft can be checked before it goes live.",
  operationId: "postFeatureEvaluate",
  tags: ["features-v2"],
  method: "post" as const,
  path: "/features/:id/evaluate",
  version: "v2" as const,
  exampleRequest: {
    params: { id: "new-checkout" },
    body: { attributes: { id: "user-123", country: "US" }, version: 4 },
  },
};

export const getFeatureDependentsValidator = {
  bodySchema: z.never(),
  querySchema: z.never(),
  paramsSchema: z.object({ id: z.string() }).strict(),
  responseSchema: z
    .object({
      features: z
        .array(z.string())
        .describe("Flags that use this one as a prerequisite"),
      experiments: z
        .array(z.object({ id: z.string(), name: z.string() }))
        .describe("Experiments that use this flag as a prerequisite"),
    })
    .strict(),
  summary: "Get the flags and experiments that depend on a feature flag",
  description:
    "Check this before archiving or deleting a flag. Includes archived dependents.",
  operationId: "getFeatureDependents",
  tags: ["features-v2"],
  method: "get" as const,
  path: "/features/:id/dependents",
  version: "v2" as const,
};
