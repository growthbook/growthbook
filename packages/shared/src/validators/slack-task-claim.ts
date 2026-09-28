import { z } from "zod";
import { baseSchema } from "./base-model";

/**
 * One collection holds the Slack assistant's coordination claims, told apart
 * by id prefix:
 * - `action:` and `link:` are permanent, created once and never released. An
 *   action claim marks an approval as dispatched or retired so a retried click
 *   cannot replay the mutation; a link claim makes account-link consent
 *   idempotent.
 * - `thread:` is a lease that holds a Slack thread for one assistant turn. It
 *   carries the holder's token and a deadline, and is released by the holder
 *   or taken over once expired, so turns in one thread never overlap.
 */
export const slackTaskClaimSchema = baseSchema.safeExtend({
  id: z.string().regex(/^(action|link|thread):[a-f0-9]{64}$/),
  token: z.string().optional(),
  expiresAt: z.date().optional(),
});

export type SlackTaskClaimInterface = z.infer<typeof slackTaskClaimSchema>;
