import { SLACK_BOT_SCOPES } from "shared/slack-integration";
import { load } from "js-yaml";
import {
  buildSlackAppManifest,
  getSlackChannelSummary,
} from "@/components/SlackIntegrations/slackSetupUtils";

describe("Slack setup helpers", () => {
  it.each(["", "/", "///"])(
    "routes callbacks to the app and inbound requests to the API with suffix '%s'",
    (suffix) => {
      const manifest = buildSlackAppManifest({
        appUrl: `https://growthbook.example${suffix}`,
        apiUrl: `https://api.growthbook.example/proxy${suffix}`,
      });
      expect(load(manifest)).toMatchObject({
        features: {
          app_home: {
            messages_tab_enabled: true,
            messages_tab_read_only_enabled: false,
          },
          agent_view: { agent_description: expect.any(String) },
        },
        oauth_config: {
          redirect_urls: ["https://growthbook.example/integrations/slack"],
          scopes: { bot: SLACK_BOT_SCOPES },
        },
        settings: {
          event_subscriptions: {
            request_url:
              "https://api.growthbook.example/proxy/integrations/slack/events",
            bot_events: ["app_mention", "message.im", "app_home_opened"],
          },
          interactivity: {
            is_enabled: true,
            request_url:
              "https://api.growthbook.example/proxy/integrations/slack/interactions",
          },
        },
      });
      expect(manifest).not.toContain("channels:history");
      expect(manifest).not.toContain("groups:history");
    },
  );
  it("summarizes wildcard subscriptions and resolves the project name", () => {
    expect(
      getSlackChannelSummary(
        { projects: ["p1"], events: ["experiment.*", "feature.*"] },
        [{ id: "p1", name: "Website" }],
      ),
    ).toBe("Website · experiments + flags");
  });
  it("does not hide uncatalogued subscriptions or missing projects", () => {
    expect(
      getSlackChannelSummary(
        { projects: ["deleted"], events: ["metric.created"] },
        [],
      ),
    ).toBe("deleted · other events");
    expect(getSlackChannelSummary({ projects: [], events: [] }, [])).toBe(
      "All Projects · no events",
    );
  });
});
