import { z } from "zod";
import type { SlackAssistantMention } from "back-end/src/services/slack/slackThreadRouting";

const messageSchema = z.object({
  user: z.string().min(1),
  channel: z.string().min(1),
  ts: z.string().min(1),
  text: z.string().min(1),
  thread_ts: z.string().min(1).optional(),
  bot_id: z.string().optional(),
  subtype: z.string().optional(),
});

const assistantEventSchema = z.object({
  type: z.literal("event_callback"),
  team_id: z.string().min(1),
  event_id: z.string().min(1),
  authorizations: z
    .array(z.object({ user_id: z.string().optional() }))
    .optional(),
  event: z.discriminatedUnion("type", [
    messageSchema.extend({ type: z.literal("app_mention") }),
    messageSchema.extend({
      type: z.literal("message"),
      channel_type: z.literal("im"),
    }),
  ]),
});

export function getSlackAssistantEvent(payload: unknown): {
  eventId: string;
  mention: SlackAssistantMention;
} | null {
  const parsed = assistantEventSchema.safeParse(payload);
  if (!parsed.success) return null;
  const { event, team_id, event_id, authorizations } = parsed.data;
  const botUserId = authorizations?.[0]?.user_id;
  if (event.bot_id || event.subtype || event.user === botUserId) return null;

  // Channel messages must arrive as app_mention; DMs never produce that event,
  // even when the user explicitly mentions the bot.
  return {
    eventId: event_id,
    mention: {
      teamId: team_id,
      channelId: event.channel,
      slackUserId: event.user,
      text: event.text,
      messageTs: event.ts,
      threadTs: event.thread_ts,
      botUserId,
    },
  };
}
