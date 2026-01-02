import { z } from "zod";

export const vectors = z
  .object({
    id: z.string(),
    joinId: z.string(),
    organization: z.string(),
    type: z.enum(["experiment", "metric"]),
    embeddings: z.array(z.number()),
    keywords: z.array(z.string()).optional(),
    dateCreated: z.date(),
    dateUpdated: z.date(),
  })
  .strict();

export type Vectors = z.infer<typeof vectors>;
