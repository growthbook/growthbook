import {
  buildSlackAppManifest,
  getSlackChannelSummary,
} from "@/components/SlackIntegrations/slackSetupUtils";

describe("Slack setup helpers", () => {
  it("uses the instance callback URL and requested scopes in the manifest", () => {
    const manifest = buildSlackAppManifest({
      appUrl: "https://growthbook.example/",
      scopes: ["chat:write", "files:write"],
    });
    expect(manifest).toContain(
      '"https://growthbook.example/integrations/slack"',
    );
    expect(manifest).toContain("      - files:write");
    expect(manifest).not.toContain("event_subscriptions");
    expect(manifest).not.toContain("example//integrations");
  });
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
