import { z } from "zod";
import { featureEnvironment } from "back-end/src/validators/features";

export const holdoutLinkedItemValidator = z.object({
  dateAdded: z.date(),
  id: z.string(),
}); // TODO: Consider using an object with ids as keys instead of an array

export const holdoutValidator = z
  .object({
    id: z.string(),
    organization: z.string(),
    dateCreated: z.date(),
    dateUpdated: z.date(),
    projects: z.array(z.string()),
    name: z.string(),
    experimentId: z.string(),
    linkedExperiments: z.array(holdoutLinkedItemValidator),
    linkedFeatures: z.array(holdoutLinkedItemValidator),
    environmentSettings: z.record(z.string(), featureEnvironment),
    analysisStartDate: z.date().optional(),
  })
  .strict();

export type HoldoutInterface = z.infer<typeof holdoutValidator>;
