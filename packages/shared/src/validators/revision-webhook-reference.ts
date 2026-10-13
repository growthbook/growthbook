// What a revision webhook says about its revision. The full record is a REST
// lookup away, by the entity and version.

import { z } from "zod";
import { actorIdField, apiEventUser } from "./event-user";
import { revisionScheduleResponseFields } from "./shared";

export const revisionWebhookReference = z.object({
  id: z.string().optional().describe("Revision ID"),
  version: z.number().int().optional(),
  baseVersion: z
    .number()
    .int()
    .optional()
    .describe("The live version a Feature Flag draft is based on"),
  status: z.string(),
  title: z.string().optional(),
  authorId: actorIdField,
  author: apiEventUser.optional(),
  ...revisionScheduleResponseFields,
});

export const revisionWebhookReview = {
  reviewer: apiEventUser,
  reviewComment: z.string().nullable(),
};

export const keyedEntityReference = z.object({
  id: z.string(),
  key: z.string(),
  name: z.string(),
});
