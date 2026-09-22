import { z } from "zod";
import { baseSchema } from "./base-model";

export const slackTaskClaimSchema = baseSchema.safeExtend({
  id: z.string().regex(/^(action|link|thread):[a-f0-9]{64}$/),
  // Thread claims expire and are released by their owner. Permanent action and
  // link claims carry neither field.
  token: z.string().optional(),
  expiresAt: z.date().optional(),
});

export type SlackTaskClaimInterface = z.infer<typeof slackTaskClaimSchema>;
