import { z } from "zod";
import { zodNotificationEventNamesEnum } from "./events";
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

// Explicit defaults avoid subscribing new channels to high-volume significance
// events or future event families without an administrator selecting them.
export const defaultSlackNotificationEvents = [
  "experiment.started",
  "experiment.stopped",
  "experiment.decision.ship",
  "experiment.decision.rollback",
  "experiment.decision.review",
  "experiment.metric.regression",
  "experiment.warning",
  "experiment.health.guardrailFailed",
  "feature.revision.published",
  "feature.revision.reverted",
  "feature.saferollout.ship",
  "feature.saferollout.rollback",
  "feature.saferollout.unhealthy",
  "feature.revision.reviewRequested",
  "feature.revision.changesRequested",
].filter((event) =>
  zodNotificationEventNamesEnum.some((supported) => supported === event),
);
