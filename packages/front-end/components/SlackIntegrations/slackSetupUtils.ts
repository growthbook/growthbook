import { SlackOAuthIntegrationInterface } from "shared/types/slack-integration";
import { slackEventOptions, matchesSlackEvent } from "./slackEventOptions";

// Notifications-only manifest pre-filled with this instance's app URL.
export function buildSlackAppManifest({
  appUrl,
  scopes,
}: {
  appUrl: string;
  scopes: string[];
}): string {
  appUrl = appUrl.replace(/\/+$/, "");
  return `display_information:
  name: GrowthBook
  description: GrowthBook experiment and feature-flag notifications
features:
  bot_user:
    display_name: GrowthBook
    always_online: true
oauth_config:
  redirect_urls:
    - ${JSON.stringify(`${appUrl}/integrations/slack`)}
  scopes:
    bot:
${scopes.map((scope) => `      - ${scope}`).join("\n")}
settings:
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
    slackEventOptions.some(
      (option) =>
        option.category === category &&
        option.events.some((event) =>
          channel.events.some((subscription) =>
            matchesSlackEvent(subscription, event),
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
