import { z } from "zod";
import { createBaseSchemaWithPrimaryKey } from "./base-model";

export const slackWorkspaceConnectionSchema = createBaseSchemaWithPrimaryKey({
  teamId: z.string().min(1),
}).safeExtend({
  encryptedBotAccessToken: z.string().min(1),
  appId: z.string().optional(),
  teamName: z.string().optional(),
  enterpriseId: z.string().optional(),
  enterpriseName: z.string().optional(),
  botUserId: z.string().optional(),
  authedUserId: z.string().optional(),
  scope: z.string().optional(),
  isEnterpriseInstall: z.boolean().optional(),
});

export type SlackWorkspaceConnectionInterface = z.infer<
  typeof slackWorkspaceConnectionSchema
>;

export type SlackWorkspaceConnectionFrontEndInterface = Omit<
  SlackWorkspaceConnectionInterface,
  "encryptedBotAccessToken" | "organization"
>;
