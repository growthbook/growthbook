import { z } from "zod";
import { MAX_POPULATION_STEPS } from "shared/populations";
import { apiBaseSchema, baseSchema } from "./base-model";
import { namedSchema } from "./openapi-helpers";
import { rowFilterValidator } from "./fact-table";
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
      'Conditions on each unit\'s total within the queried date range, such as ">=3" or ">=3,<10". Requires aggregateFilterColumn',
    ),
  aggregateFilterColumn: z
    .string()
    .optional()
    .describe(
      'Numeric column to total, or "$$count" to count rows. Requires aggregateFilter',
    ),
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
