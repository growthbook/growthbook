import { FeatureInterface } from "shared/types/feature";
import {
  buildFeatureConfigurationClipboardPayload,
  parseFeatureConfigurationClipboardPayload,
} from "@/services/feature-configuration-clipboard";

const feature: FeatureInterface = {
  id: "new-homepage",
  organization: "org_123",
  owner: "user_123",
  dateCreated: new Date("2026-01-01T00:00:00.000Z"),
  dateUpdated: new Date("2026-01-02T00:00:00.000Z"),
  valueType: "boolean",
  defaultValue: "false",
  version: 3,
  description: "Controls the new homepage",
  project: "web",
  tags: ["growth"],
  environmentSettings: {
    dev: { enabled: true },
    production: { enabled: false },
  },
  rules: [
    {
      id: "fr_homepage",
      type: "force",
      description: "Enable for beta users",
      condition: '{"id":{"$in":["beta-user"]}}',
      allEnvironments: true,
      value: "true",
    },
  ],
  customFields: {
    team: "growth",
  },
  archived: false,
};

describe("feature configuration clipboard payloads", () => {
  it("builds and parses a GrowthBook feature clipboard envelope", () => {
    const payload = parseFeatureConfigurationClipboardPayload(
      buildFeatureConfigurationClipboardPayload(feature),
    );

    expect(payload).not.toBeNull();
    expect(payload?.growthbook).toMatchObject({
      source: "growthbook",
      object: "feature",
      version: 1,
    });
    expect(payload?.feature).toMatchObject({
      id: "new-homepage",
      valueType: "boolean",
      defaultValue: "false",
      rules: feature.rules,
    });
  });

  it("ignores non-JSON clipboard text", () => {
    expect(parseFeatureConfigurationClipboardPayload("not json")).toBeNull();
  });

  it("rejects JSON without the GrowthBook feature envelope", () => {
    expect(
      parseFeatureConfigurationClipboardPayload(
        JSON.stringify({ feature: { id: "missing-metadata" } }),
      ),
    ).toBeNull();
  });
});
