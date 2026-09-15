import { z } from "zod";
import { createBaseSchemaWithPrimaryKey } from "./base-model";

export const slackUserLinkSchema = createBaseSchemaWithPrimaryKey({
  slackTeamId: z.string().min(1),
  slackUserId: z.string().min(1),
}).safeExtend({
  growthbookUserId: z.string().min(1),
});

export type SlackUserLinkInterface = z.infer<typeof slackUserLinkSchema>;
