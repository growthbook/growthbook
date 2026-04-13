import { z } from "zod";
import { ownerField } from "./owner-field";

const TYPES = ["SQL", "FACT"] as const;

export const segmentValidator = z
  .object({
    id: z.string(),
    organization: z.string(),
    owner: ownerField,
    datasource: z.string(),
    dateCreated: z.date(),
    dateUpdated: z.date(),
    name: z.string(),
    description: z.string(),
    userIdType: z.string(),
    type: z.enum(TYPES),
    managedBy: z.enum(["", "api", "config"]).optional(),
    sql: z.string().optional(),
    factTableId: z.string().optional(),
    filters: z.array(z.string()).optional(),
    projects: z.array(z.string()).optional(),
  })
  .strict();

export const createSegmentModelValidator = segmentValidator.omit({
  id: true,
  organization: true,
  dateCreated: true,
  dateUpdated: true,
});

export const updateSegmentModelValidator = segmentValidator.omit({
  id: true,
  organization: true,
  dateCreated: true,
  dateUpdated: true,
});
