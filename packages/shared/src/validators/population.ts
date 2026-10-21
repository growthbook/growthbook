import { z } from "zod";
import { MAX_POPULATION_STEPS } from "shared/populations";
import { apiBaseSchema, baseSchema } from "./base-model";
import { namedSchema } from "./openapi-helpers";
import { rowFilterValidator, windowSettingsValidator } from "./fact-table";
import { queryPointerValidator } from "./queries";
import {
  ownerEmailField,
  ownerField,
  ownerInputField,
  requiredUnlessPersonOwnerInputField,
} from "./owner-field";

// Only fact table sources for now. Experiment and feature exposure sources are
// planned, which is why this is a discriminated union.
export const populationStepSourceValidator = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("factTable"),
    factTableId: z.string(),
  }),
]);

export const populationStepValidator = z.strictObject({
  source: populationStepSourceValidator,
  rowFilters: z.array(rowFilterValidator),
  aggregateFilter: z
    .string()
    .optional()
    .describe(
      'Conditions on each unit\'s total within the window, such as ">=3" or ">=3,<10". Requires aggregateFilterColumn',
    ),
  aggregateFilterColumn: z
    .string()
    .optional()
    .describe(
      'Numeric column to total, or "$$count" to count rows. Requires aggregateFilter',
    ),
  windowSettings: windowSettingsValidator,
});

export const populationValidator = baseSchema
  .extend({
    projects: z.array(z.string()).optional(),
    owner: ownerField,
    name: z.string().min(1),
    description: z.string(),
    datasource: z.string(),
    userIdTypes: z.array(z.string()).min(1),
    steps: z.array(populationStepValidator).min(1).max(MAX_POPULATION_STEPS),
  })
  .strict();

export type PopulationInterface = z.infer<typeof populationValidator>;
export type PopulationStep = z.infer<typeof populationStepValidator>;

/* ------------------------------------------------------------ membership */

const populationMembershipCountsShape = {
  members: z.number().describe("Units in the Population at this date"),
  joined: z
    .number()
    .describe("Units in the Population now that weren't at the earlier date"),
  left: z
    .number()
    .describe("Units at the earlier date that aren't in the Population now"),
};

export const populationMembershipResultValidator = z.strictObject({
  asOf: z.iso.datetime().describe("Membership is calculated as of this time"),
  summary: z.strictObject({
    ...populationMembershipCountsShape,
    comparedTo: z.iso
      .datetime()
      .describe("The earlier date that joined and left are measured from"),
  }),
  series: z
    .array(
      z.strictObject({
        date: z.iso.datetime(),
        ...populationMembershipCountsShape,
      }),
    )
    .describe(
      "Weekly membership, oldest first. Joined and left compare each week with the week before",
    ),
});

export type PopulationMembershipResult = z.infer<
  typeof populationMembershipResultValidator
>;

export const populationAnalysisStatusValidator = z.enum([
  "running",
  "success",
  "error",
]);

export const populationAnalysisValidator = baseSchema
  .extend({
    population: z.string(),
    datasource: z.string(),
    userIdType: z.string(),
    // The definition the analysis ran against, so a later edit can be shown as
    // not yet applied.
    steps: z.array(populationStepValidator),
    asOf: z.date(),
    status: populationAnalysisStatusValidator,
    error: z.string().nullable(),
    runStarted: z.date().nullable(),
    queries: z.array(queryPointerValidator),
    result: populationMembershipResultValidator.nullable(),
  })
  .strict();

export type PopulationAnalysisInterface = z.infer<
  typeof populationAnalysisValidator
>;

/* ------------------------------------------------------------------ the API */

export const apiPopulationValidator = namedSchema(
  "Population",
  apiBaseSchema
    .extend({
      projects: z.array(z.string()),
      owner: ownerField,
      ownerEmail: ownerEmailField,
      name: z.string(),
      description: z.string(),
      datasource: z.string(),
      userIdTypes: z.array(z.string()),
      steps: z.array(populationStepValidator),
    })
    .strict(),
);

export type ApiPopulation = z.infer<typeof apiPopulationValidator>;

const apiPopulationStepInput = populationStepValidator.extend({
  rowFilters: z.array(rowFilterValidator).optional(),
  windowSettings: windowSettingsValidator
    .optional()
    .describe(
      "Defaults to no window. Conversion windows are only allowed on steps after the first",
    ),
});

export const apiCreatePopulationBody = z
  .strictObject({
    name: z.string().min(1),
    description: z.string().optional(),
    owner: requiredUnlessPersonOwnerInputField,
    projects: z.array(z.string()).optional(),
    datasource: z.string().describe("Id of the Data Source"),
    userIdTypes: z
      .array(z.string())
      .min(1)
      .describe(
        "Identifier types the Population can be joined on. Every step's fact table must support all of them",
      ),
    steps: z
      .array(apiPopulationStepInput)
      .min(1)
      .max(MAX_POPULATION_STEPS)
      .describe(
        `Steps a unit must complete, in order, to be included. Currently limited to ${MAX_POPULATION_STEPS} step with support for multiple steps coming soon.`,
      ),
  })
  .describe("Create a Population");

export const apiUpdatePopulationBody = apiCreatePopulationBody
  .omit({ datasource: true, owner: true })
  .partial()
  .extend({ owner: ownerInputField.optional() })
  .describe("Update a Population");

export const apiPopulationAnalysisValidator = namedSchema(
  "PopulationAnalysis",
  apiBaseSchema
    .extend({
      population: z.string(),
      datasource: z.string(),
      userIdType: z.string(),
      steps: z
        .array(populationStepValidator)
        .describe("The Population's steps when this analysis ran"),
      asOf: z.iso.datetime(),
      status: populationAnalysisStatusValidator,
      error: z.string().nullable(),
      queries: z.array(z.string()).describe("Ids of the queries that ran"),
      result: populationMembershipResultValidator.nullable(),
    })
    .strict(),
);

export type ApiPopulationAnalysis = z.infer<
  typeof apiPopulationAnalysisValidator
>;

const populationIdParam = z.strictObject({
  id: z.string().describe("The Population id"),
});

export const apiRefreshPopulationValidator = {
  paramsSchema: populationIdParam,
  bodySchema: z.never(),
  querySchema: z.never(),
};

export const apiGetPopulationAnalysisValidator = {
  paramsSchema: populationIdParam,
  bodySchema: z.never(),
  querySchema: z.never(),
};

export const apiPopulationAnalysisReturn = z.strictObject({
  analysis: apiPopulationAnalysisValidator,
});

export const apiLatestPopulationAnalysisReturn = z.strictObject({
  analysis: apiPopulationAnalysisValidator
    .nullable()
    .describe("Null until the Population has been refreshed"),
});
