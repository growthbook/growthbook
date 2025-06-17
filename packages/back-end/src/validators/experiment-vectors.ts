import { z } from "zod";

export const experimentVectors = z
  .object({
    id: z.string(),
    experimentId: z.string(),
    organization: z.string(),
    embeddings: z.array(z.number()),
    keywords: z.array(z.string()).optional(),
    dateCreated: z.date(),
    dateUpdated: z.date(),
  })
  .strict();

export type ExperimentVectors = z.infer<typeof experimentVectors>;
