import { z } from "zod";
import { baseSchema } from "./base-model";

// The organization default's `project` value
export const ORG_DEFAULT_SCOPE = "";

// Experimentation Health settings for one scope: the organization default
// or a single Project. A field left unset on a Project record inherits the
// organization default's value.
export const experimentationHealthQualitySettingsValidator = z
  .object({
    enabled: z.boolean().optional(),
    // A named ExperimentQualityConfig; unset uses the built-in default (org
    // record) or the organization default's choice (Project record)
    configId: z.string().optional(),
  })
  .strict();
export type ExperimentationHealthQualitySettings = z.infer<
  typeof experimentationHealthQualitySettingsValidator
>;

export const experimentationHealthSettingsValidator = baseSchema
  .extend({
    project: z.string(),
    quality: experimentationHealthQualitySettingsValidator.optional(),
  })
  .strict();
export type ExperimentationHealthSettingsInterface = z.infer<
  typeof experimentationHealthSettingsValidator
>;
