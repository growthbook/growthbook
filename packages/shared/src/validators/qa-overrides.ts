import { z } from "zod";
import { savedGroupTargeting } from "./shared";

export const qaOverrideFiltersValidator = z
  .object({
    condition: z.string().optional(),
    savedGroups: z.array(savedGroupTargeting).optional(),
    sdkConnections: z.array(z.string()).optional(),
    projects: z.array(z.string()).optional(),
  })
  .strict();

export const qaOverrideBaseValidator = z.object({
  id: z.string(),
  organization: z.string(),
  dateCreated: z.date(),
  dateUpdated: z.date(),
  environment: z.string(),
  order: z.number().int().min(0),
  filters: qaOverrideFiltersValidator,
  createdBy: z.string(),
});
