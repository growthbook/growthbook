import { z } from "zod";
import { baseSchema } from "./base-model";

export const ideaSourceValidator = z.enum(["web", "slack"]);

export const voteValidator = z.object({
  userId: z.string(),
  dir: z.union([z.literal(1), z.literal(-1)]),
  dateCreated: z.date(),
  dateUpdated: z.date(),
});

export const estimateParamsValidator = z.object({
  // Deleting a segment $unsets this field from existing ideas, so documents
  // can have estimateParams without a segment
  segment: z.string().optional(),
  estimate: z.string(),
  improvement: z.number(),
  numVariations: z.number(),
  userAdjustment: z.number(),
});

export const ideaValidator = baseSchema.safeExtend({
  text: z.string(),
  archived: z.boolean(),
  details: z.string().optional(),
  userId: z.string().nullable(),
  userName: z.string().optional(),
  source: ideaSourceValidator.optional(),
  project: z.string().optional(),
  tags: z.array(z.string()),
  votes: z.array(voteValidator).optional(),
  impactScore: z.number(),
  experimentLength: z.number(),
  estimateParams: estimateParamsValidator.optional(),
});
