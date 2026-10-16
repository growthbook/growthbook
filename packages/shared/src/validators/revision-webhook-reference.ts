// What every revision webhook says about its revision: who, when and its review
// and schedule state. Each entity adds the revision's content.

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

// Loose so the docs generator can render it; operations keep their `value`.
export const webhookProposedChanges = z
  .array(z.object({ op: z.string(), path: z.string() }).passthrough())
  .describe("The JSON Patch the draft applies, with each change's value");

export const revisionWebhookReview = {
  reviewer: apiEventUser,
  reviewComment: z.string().nullable(),
};

export const keyedEntityReference = z.object({
  id: z.string(),
  key: z.string(),
  name: z.string(),
});
