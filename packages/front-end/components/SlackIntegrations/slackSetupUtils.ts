import { SLACK_BOT_EVENTS, SLACK_BOT_SCOPES } from "shared/slack-integration";
import { SlackOAuthIntegrationInterface } from "shared/types/slack-integration";
import {
  notificationEventOptions,
  matchesNotificationEvent,
} from "shared/notifications";

export function buildSlackAppManifest({
  appUrl,
  apiUrl,
}: {
  appUrl: string;
  apiUrl: string;
}): string {
  appUrl = appUrl.replace(/\/+$/, "");
  apiUrl = apiUrl.replace(/\/+$/, "");
  return `display_information:
  name: GrowthBook
  description: GrowthBook AI assistant and notifications
  background_color: "#08043b"
  long_description: >-
    Connect GrowthBook to Slack to receive experiment and Feature Flag
    notifications and chat with the GrowthBook AI assistant. Ask about running
    experiments, active Feature Flags, and other GrowthBook resources.
features:
  app_home:
    messages_tab_enabled: true
    messages_tab_read_only_enabled: false
  agent_view:
    agent_description: Ask questions about experiments and Feature Flags in GrowthBook.
  bot_user:
    display_name: GrowthBook
    always_online: true
  unfurl_domains:
    - ${JSON.stringify(new URL(appUrl).hostname)}
oauth_config:
  pkce_enabled: false
  redirect_urls:
    - ${JSON.stringify(`${appUrl}/integrations/slack`)}
  scopes:
    bot:
${SLACK_BOT_SCOPES.map((scope) => `      - ${scope}`).join("\n")}
settings:
  event_subscriptions:
    request_url: ${JSON.stringify(`${apiUrl}/integrations/slack/events`)}
    bot_events:
${SLACK_BOT_EVENTS.map((event) => `      - ${event}`).join("\n")}
  interactivity:
    is_enabled: true
    request_url: ${JSON.stringify(`${apiUrl}/integrations/slack/interactions`)}
  org_deploy_enabled: false
  socket_mode_enabled: false
  token_rotation_enabled: false`;
}

export const getSlackChannelSummary = (
  channel: Pick<SlackOAuthIntegrationInterface, "events" | "projects">,
  projects: { id: string; name: string }[],
) => {
  const project =
    channel.projects.length === 0
      ? "All Projects"
      : channel.projects.length === 1
        ? projects.find((p) => p.id === channel.projects[0])?.name ||
          channel.projects[0]
        : `${channel.projects.length} projects`;
  const categories = ["experiment", "feature"].filter((category) =>
    notificationEventOptions.some(
      (option) =>
        option.category === category &&
        option.events.some((event) =>
          channel.events.some((subscription) =>
            matchesNotificationEvent(subscription, event),
          ),
        ),
    ),
  );
  const subjects =
    categories.length === 2
      ? "experiments + flags"
      : categories[0] === "experiment"
        ? "experiments"
        : categories[0] === "feature"
          ? "flags"
          : channel.events.length
            ? "other events"
            : "no events";
  return `${project} · ${subjects}`;
};
