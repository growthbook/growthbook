import { z } from "zod";
import { baseSchema } from "./base-model";

export const slackNotificationBatchSchema = baseSchema.safeExtend({
  eventWebHookId: z.string(),
  experimentId: z.string(),
  eventIds: z.array(z.string()).max(100),
  attempts: z.number().int().min(0),
  flushAt: z.date(),
  expiresAt: z.date(),
  status: z.enum(["pending", "processing", "sent", "failed"]),
  leaseUntil: z.date().optional(),
});
export type SlackNotificationBatch = z.infer<
  typeof slackNotificationBatchSchema
>;
