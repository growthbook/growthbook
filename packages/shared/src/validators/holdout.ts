import { z } from "zod";
import { featureEnvironment } from "./features.js";

export const holdoutLinkedItemValidator = z.object({
  dateAdded: z.date(),
  id: z.string(),
});

export const holdoutValidator = z
  .object({
    id: z.string(),
    organization: z.string(),
    dateCreated: z.date(),
    dateUpdated: z.date(),
    projects: z.array(z.string()),
    name: z.string(),
    experimentId: z.string(),
    linkedExperiments: z.record(z.string(), holdoutLinkedItemValidator),
    linkedFeatures: z.record(z.string(), holdoutLinkedItemValidator),
    environmentSettings: z.record(z.string(), featureEnvironment),
    analysisStartDate: z.date().optional(),
  })
  .strict();

export type HoldoutInterface = z.infer<typeof holdoutValidator>;
