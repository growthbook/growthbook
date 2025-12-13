import { z } from "zod";
import { statsEngines } from "shared/constants";
import { managedByValidator, baseSchema } from "shared/validators";

export const statsEnginesValidator = z.enum(statsEngines);

export const projectSettingsValidator = z.object({
  statsEngine: statsEnginesValidator.optional(),
});

export const projectValidator = baseSchema
  .extend({
    name: z.string(),
    publicId: z.string().optional(),
    description: z.string().default("").optional(),
    settings: projectSettingsValidator.default({}).optional(),
    managedBy: managedByValidator.optional(),
  })
  .strict();

export type StatsEngine = z.infer<typeof statsEnginesValidator>;
export type ProjectSettings = z.infer<typeof projectSettingsValidator>;
export type ProjectInterface = z.infer<typeof projectValidator>;
