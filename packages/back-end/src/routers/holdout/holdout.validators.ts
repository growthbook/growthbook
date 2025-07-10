import { z } from "zod";

export const holdoutLinkedItemValidator = z.object({
  dateAdded: z.date(),
  id: z.string(),
}); // TODO: Consider using an object with ids as keys instead of an array

// export const analysisSettingsValidator = z
//   .object({
//     // TODO: Move to experiment snapshot settings
//     analysisWindow: z
//       .object({
//         start: z.date(),
//         end: z.date(),
//       })
//       .optional(),
//   })
//   .optional();

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
    environments: z.array(z.string()),
    analysisStartDate: z.date().optional(),
    holdoutStopDate: z.date().optional(),
    holdoutStartDate: z.date().optional(),
  })
  .strict();

export type HoldoutInterface = z.infer<typeof holdoutValidator>;
