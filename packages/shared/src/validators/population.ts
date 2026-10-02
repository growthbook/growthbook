import { z } from "zod";
import { MAX_DESCRIPTION_LENGTH } from "shared/constants";
import { apiBaseSchema } from "./base-model";
import { namedSchema } from "./openapi-helpers";
import { ownerEmailField, ownerField, ownerInputField } from "./owner-field";
import {
  isValidRowFilterRangeLength,
  ROW_FILTER_RANGE_LENGTH_MESSAGE,
  rowFilterOperators,
  rowFilterValidator,
  windowSettingsValidator,
} from "./fact-table";

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

// --- External REST API shapes ---

// API uses "none" instead of the internal empty-string window type (same as
// Fact Metrics). Mapped in PopulationModel processApi*/toApiInterface.
const apiPopulationWindowSettings = z
  .object({
    type: z.enum(["none", "conversion", "lookback"]),
    delayValue: z.coerce.number(),
    delayUnit: z.enum(["minutes", "hours", "days", "weeks"]),
    windowValue: z.number(),
    windowUnit: z.enum(["minutes", "hours", "days", "weeks"]),
  })
  .strict()
  .describe(
    "Controls which event timestamps count for this step. Conversion windows (and delay) are only allowed on steps after the first.",
  );

const apiPopulationRowFilter = z
  .object({
    operator: z.enum(rowFilterOperators),
    column: z.string().optional(),
    values: z.array(z.string()).optional(),
  })
  .refine(isValidRowFilterRangeLength, {
    message: ROW_FILTER_RANGE_LENGTH_MESSAGE,
    path: ["values"],
  });

export const apiPopulationStepSourceValidator = z.discriminatedUnion("type", [
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

export const apiPopulationStepValidator = z
  .object({
    source: apiPopulationStepSourceValidator,
    rowFilters: z.array(apiPopulationRowFilter),
    aggregateFilter: z.string().optional(),
    aggregateFilterColumn: z.string().optional(),
    windowSettings: apiPopulationWindowSettings,
  })
  .strict();

export const apiPopulationValidator = namedSchema(
  "Population",
  apiBaseSchema.safeExtend({
    owner: ownerField,
    ownerEmail: ownerEmailField,
    name: z.string(),
    description: z.string().max(MAX_DESCRIPTION_LENGTH),
    projects: z.array(z.string()),
    datasource: z.string(),
    userIdTypes: z.array(z.string()),
    steps: z.array(apiPopulationStepValidator).min(1),
  }),
);

export type ApiPopulation = z.infer<typeof apiPopulationValidator>;

export const apiCreatePopulationBody = z.strictObject({
  name: z.string(),
  description: z.string().max(MAX_DESCRIPTION_LENGTH).optional(),
  projects: z.array(z.string()).optional(),
  owner: ownerInputField.optional(),
  datasource: z.string(),
  userIdTypes: z.array(z.string()).optional(),
  steps: z.array(apiPopulationStepValidator).min(1),
});

// datasource is readonly after create (PopulationModel.readonlyFields)
export const apiUpdatePopulationBody = apiCreatePopulationBody
  .omit({ datasource: true })
  .partial();

/** Map API window type ("none") to internal storage (""). */
export function fromApiPopulationWindowSettings(
  windowSettings: z.infer<typeof apiPopulationWindowSettings>,
): z.infer<typeof windowSettingsValidator> {
  return {
    ...windowSettings,
    type: windowSettings.type === "none" ? "" : windowSettings.type,
  };
}

/** Map internal window type ("") to API ("none"). */
export const toApiPopulationWindowSettings = (
  windowSettings: z.infer<typeof windowSettingsValidator>,
): z.infer<typeof apiPopulationWindowSettings> => ({
  ...windowSettings,
  type: windowSettings.type || "none",
});

export function fromApiPopulationStep(
  step: z.infer<typeof apiPopulationStepValidator>,
): z.infer<typeof populationStepValidator> {
  return {
    ...step,
    rowFilters: step.rowFilters ?? [],
    windowSettings: fromApiPopulationWindowSettings(step.windowSettings),
  };
}

export function toApiPopulationStep(
  step: z.infer<typeof populationStepValidator>,
): z.infer<typeof apiPopulationStepValidator> {
  return {
    ...step,
    rowFilters: step.rowFilters ?? [],
    windowSettings: toApiPopulationWindowSettings(step.windowSettings),
  };
}
