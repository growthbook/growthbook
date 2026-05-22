import { z } from "zod";
import {
  powerCalculationParamsSchema,
  powerCalculationResultsSchema,
} from "../power/power";
import { baseSchema } from "./base-model";
import { ownerField, ownerInputField } from "./owner-field";

export const powerCalculationResultsWithComputedAtSchema = z
  .object({
    data: powerCalculationResultsSchema,
    computedAt: z.date(),
  })
  .strict();

export type PowerCalculationResultsWithComputedAt = z.infer<
  typeof powerCalculationResultsWithComputedAtSchema
>;

export const powerCalculationValidator = baseSchema
  .extend({
    name: z.string(),
    description: z.string().optional(),
    owner: ownerField.optional(),
    project: z.string(),
    inputs: powerCalculationParamsSchema,
    // `results` is computed server-side. It is optional in the schema so that
    // creates can omit it; the model populates it in `beforeCreate` before
    // inserting the document.
    results: powerCalculationResultsWithComputedAtSchema.optional(),
  })
  .strict();

export type PowerCalculationInterface = z.infer<
  typeof powerCalculationValidator
>;

export const createPowerCalculationBodySchema = z
  .object({
    name: z.string(),
    description: z.string().optional(),
    owner: ownerInputField.optional(),
    project: z.string(),
    inputs: powerCalculationParamsSchema,
  })
  .strict();

export type CreatePowerCalculationBody = z.infer<
  typeof createPowerCalculationBodySchema
>;

export const updatePowerCalculationBodySchema = z
  .object({
    name: z.string().optional(),
    description: z.string().optional(),
    owner: ownerInputField.optional(),
    project: z.string().optional(),
    inputs: powerCalculationParamsSchema.optional(),
  })
  .strict();

export type UpdatePowerCalculationBody = z.infer<
  typeof updatePowerCalculationBodySchema
>;
