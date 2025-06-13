import { z } from "zod";

export const holdoutLinkedItemValidator = z.object({
  dateAdded: z.date(),
  id: z.string(),
});

// TODO: Define these schemas based on their actual structure
export const analysisSettingsValidator = z.object({
  analysisWindow: z.array(z.date(), z.date()).optional(), // Analysis window is a range of dates
});

export const holdoutValidator = z
  .object({
    id: z.string(),
    organization: z.string(),
    dateCreated: z.date(),
    dateUpdated: z.date(),
    projectId: z.string().optional(),
    name: z.string(),
    experimentId: z.string(),
    linkedExperiments: z.array(holdoutLinkedItemValidator),
    linkedFeatures: z.array(holdoutLinkedItemValidator),
    analysisSettings: analysisSettingsValidator,
    environments: z.array(z.string()),
  })
  .strict();

export type HoldoutInterface = z.infer<typeof holdoutValidator>;
