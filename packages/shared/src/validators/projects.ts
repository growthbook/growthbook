import { z } from "zod";
import { statsEngines } from "shared/constants";
import { managedByValidator } from "./managed-by.js";
import { baseSchema } from "./base-model.js";

export const statsEnginesValidator = z.enum(statsEngines);

export const projectSettingsValidator = z.object({
  statsEngine: statsEnginesValidator.optional(),
});

export const projectValidator = baseSchema
  .extend({
    name: z.string(),
    description: z.string().optional(),
    settings: projectSettingsValidator.optional(),
    managedBy: managedByValidator.optional(),
  })
  .strict();

export type StatsEngine = z.infer<typeof statsEnginesValidator>;
export type ProjectSettings = z.infer<typeof projectSettingsValidator>;
export type ProjectInterface = z.infer<typeof projectValidator>;
