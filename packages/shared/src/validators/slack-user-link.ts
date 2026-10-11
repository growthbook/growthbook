import { z } from "zod";
import { createBaseSchemaWithPrimaryKey } from "./base-model";

export const slackUserLinkSchema = createBaseSchemaWithPrimaryKey({
  slackTeamId: z.string().min(1),
  slackUserId: z.string().min(1),
}).safeExtend({
  growthbookUserId: z.string().min(1),
  linkId: z.string().min(1),
});

export type SlackUserLinkInterface = z.infer<typeof slackUserLinkSchema>;

export const slackLinkBodySchema = z.strictObject({
  state: z.string().min(1),
  organizationId: z.string().min(1),
});
export type SlackLinkBody = z.infer<typeof slackLinkBodySchema>;

export const slackLinkConsentSchema = z.object({
  slackTeamId: z.string(),
  slackUserId: z.string(),
  teamName: z.string(),
  organization: z.object({
    id: z.string(),
    name: z.string(),
    linkedAccount: z.enum(["current", "other"]).nullable(),
  }),
});
export type SlackLinkConsent = z.infer<typeof slackLinkConsentSchema>;

export const slackAccountLinkSchema = slackUserLinkSchema
  .pick({
    slackTeamId: true,
    slackUserId: true,
    linkId: true,
  })
  .extend({ teamName: z.string() });
export type SlackAccountLink = z.infer<typeof slackAccountLinkSchema>;
