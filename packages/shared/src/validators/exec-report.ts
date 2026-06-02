import { z } from "zod";
import { MAX_DESCRIPTION_LENGTH } from "shared/constants";

export const DateRangeSchema = z.object({
  startDate: z.string(),
  endDate: z.string(),
});

export const execReportValidator = z
  .object({
    id: z.string(),
    organization: z.string(),
    name: z.string().min(1),
    description: z.string().max(MAX_DESCRIPTION_LENGTH),
    dateRange: z.object({
      type: z.literal("dateRange"),
      value: DateRangeSchema,
    }),
    tags: z.array(z.string()),
    filter: z.string(),
    metrics: z.array(z.string()),
    debias: z.boolean(),
    targetWinRate: z.number(),
    targetVelocity: z.number(),
    creator: z.string().optional(),
    projects: z.array(z.string()).optional(),
    viewAccess: z.enum(["private", "members", "link"]),
    urlStub: z.string(),
    dateCreated: z.date(),
    dateUpdated: z.date(),
  })
  .strict();
