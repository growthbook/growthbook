// What a revision webhook says about its revision. The full record is a REST
// lookup away, by the entity and version.

import { z } from "zod";
import { actorIdField, apiEventUser } from "./event-user";
import { revisionScheduleResponseFields } from "./shared";

const dateTime = z.string().meta({ format: "date-time" });

export const revisionWebhookReference = z.object({
  id: z.string().optional().describe("Revision ID"),
  version: z
    .number()
    .int()
    .describe("0 for a revision saved before versions were recorded"),
  baseVersion: z
    .number()
    .int()
    .describe("The live version this revision is based on, or 0 if unknown"),
  status: z.string(),
  title: z.string().optional(),
  comment: z.string().describe("The revision's description"),
  dateCreated: dateTime,
  dateUpdated: dateTime,
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
