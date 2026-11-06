import { z } from "zod";
import { savedGroupTargeting } from "./shared";

// Narrows which requests in the environment receive the override. Every field
// is optional; an omitted or empty filter matches everything.
export const qaOverrideFiltersValidator = z
  .object({
    // JSON-encoded targeting condition, same format as feature rules.
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
  // Position among the overrides of the same target; the first match wins.
  order: z.number().int().min(0),
  filters: qaOverrideFiltersValidator,
  createdBy: z.string(),
});
