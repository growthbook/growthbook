import { z } from "zod";
import { MAX_DESCRIPTION_LENGTH } from "shared/constants";
import { ownerField } from "./owner-field";
import { rowFilterValidator, windowSettingsValidator } from "./fact-table";

export const populationStepSourceValidator = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("factTable"),
      factTableId: z.string(),
    })
    .strict(),
  z
    .object({
      type: z.literal("experiment"),
      experimentId: z.string(),
      variationIds: z.array(z.string()),
    })
    .strict(),
  z
    .object({
      type: z.literal("feature"),
      featureId: z.string(),
      values: z.array(z.string()),
    })
    .strict(),
]);

export const populationStepValidator = z
  .object({
    source: populationStepSourceValidator,
    rowFilters: z.array(rowFilterValidator),
    aggregateFilter: z.string().optional(),
    aggregateFilterColumn: z.string().optional(),
    // Conversion (and delay) only allowed on steps 2+ — enforced in PopulationModel
    windowSettings: windowSettingsValidator,
  })
  .strict();

export const populationValidator = z
  .object({
    id: z.string(),
    organization: z.string(),
    projects: z.array(z.string()),
    owner: ownerField,
    name: z.string(),
    description: z.string().max(MAX_DESCRIPTION_LENGTH),
    dateCreated: z.date(),
    dateUpdated: z.date(),
    datasource: z.string(),
    userIdTypes: z.array(z.string()),
    steps: z.array(populationStepValidator).min(1),
  })
  .strict();

export const createPopulationModelValidator = populationValidator.omit({
  id: true,
  organization: true,
  dateCreated: true,
  dateUpdated: true,
});

export const updatePopulationModelValidator = createPopulationModelValidator
  .partial()
  .strict();
