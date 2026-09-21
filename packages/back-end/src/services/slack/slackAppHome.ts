import { z } from "zod";
import { getSlackWorkspaceBotToken } from "back-end/src/services/slack/slackIdentity";
import { setSlackSuggestedPrompts } from "back-end/src/services/slack/slackWebApi";

export const slackAppHomeOpenedEventSchema = z
  .object({
    type: z.literal("event_callback"),
    team_id: z.string().min(1),
    event_id: z.string().min(1),
    event: z.object({
      type: z.literal("app_home_opened"),
      tab: z.literal("messages"),
      channel: z.string().min(1),
    }),
  })
  .transform((payload) => ({
    teamId: payload.team_id,
    channelId: payload.event.channel,
    eventId: payload.event_id,
  }));

export type SlackAppHomeOpened = z.infer<typeof slackAppHomeOpenedEventSchema>;

export async function handleSlackAppHomeOpened({
  teamId,
  channelId,
}: SlackAppHomeOpened): Promise<void> {
  const token = await getSlackWorkspaceBotToken(teamId);
  if (!token) return;

  // Replacing static prompts is safe on every open and never starts an AI turn.
  await setSlackSuggestedPrompts({
    token,
    channelId,
    title: "Ask GrowthBook about your experiments and Feature Flags",
    prompts: [
      { title: "Link my account", message: "link account" },
      {
        title: "Running experiments",
        message: "What experiments are running right now?",
      },
      {
        title: "Feature Flags",
        message: "What Feature Flags do we have?",
      },
    ],
  });
}
