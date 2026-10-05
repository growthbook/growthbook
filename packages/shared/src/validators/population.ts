import { z } from "zod";
import { apiBaseSchema, baseSchema } from "./base-model";
import { namedSchema } from "./openapi-helpers";
import { rowFilterValidator, windowSettingsValidator } from "./fact-table";
import {
  ownerEmailField,
  ownerField,
  ownerInputField,
  requiredUnlessPatOwnerInputField,
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
  aggregateFilter: z.string().optional(),
  aggregateFilterColumn: z.string().optional(),
  windowSettings: windowSettingsValidator,
});

export const populationValidator = baseSchema
  .extend({
    projects: z.array(z.string()),
    owner: ownerField,
    name: z.string().min(1),
    description: z.string(),
    datasource: z.string(),
    userIdTypes: z.array(z.string()).min(1),
    steps: z.array(populationStepValidator).min(1),
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
    owner: requiredUnlessPatOwnerInputField,
    projects: z.array(z.string()).optional(),
    datasource: z.string().describe("Id of the Data Source"),
    userIdTypes: z
      .array(z.string())
      .min(1)
      .describe(
        "Identifier types the population can be joined on. Every step's fact table must support all of them",
      ),
    steps: z
      .array(apiPopulationStepInput)
      .min(1)
      .describe("Steps a unit must complete, in order, to be included"),
  })
  .describe("Create a population");

export const apiUpdatePopulationBody = apiCreatePopulationBody
  .omit({ datasource: true, owner: true })
  .partial()
  .extend({ owner: ownerInputField.optional() })
  .describe("Update a population");
