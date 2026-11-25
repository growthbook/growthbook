import type { EventInterface } from "shared/types/events/event";
import {
  buildDatadogChangeEvent,
  DatadogEnvelope,
  getDatadogNotificationPayload,
  servedEnvironments,
} from "back-end/src/services/datadog/getDatadogNotificationPayload";

const created = new Date("2026-11-24T12:00:00Z").getTime();
const origin = "https://app.example.com";

const flag = (overrides: Record<string, unknown>) => ({
  id: "new-checkout-flow",
  project: "prj_checkout",
  tags: ["checkout"],
  archived: false,
  defaultValue: "false",
  revision: { version: 14, comment: "Ramp step 3 of 5" },
  environments: {
    production: {
      enabled: true,
      rules: [{ id: "fr_1", type: "rollout", coverage: 0.4, value: "true" }],
    },
    staging: { enabled: true, rules: [] },
  },
  ...overrides,
});

const featureUpdated = (
  overrides: Partial<DatadogEnvelope> = {},
): DatadogEnvelope => ({
  event: "feature.updated",
  created,
  projects: ["prj_checkout"],
  tags: ["checkout"],
  environments: ["production"],
  user: { type: "system", subtype: "ramp-schedule", id: "rs_8f2" },
  requestSource: "system",
  data: {
    object: flag({}),
    previous_attributes: {
      revision: { version: 13, comment: "Ramp step 2 of 5" },
      environments: {
        production: {
          enabled: true,
          rules: [
            { id: "fr_1", type: "rollout", coverage: 0.2, value: "true" },
          ],
        },
      },
    },
  },
  ...overrides,
});

const build = (envelope: DatadogEnvelope, service: string | null = null) =>
  buildDatadogChangeEvent({
    envelope,
    environments: envelope.environments,
    service,
    appOrigin: origin,
  });

describe("buildDatadogChangeEvent", () => {
  it("sends a ramp step as a change to the flag", () => {
    const relatedEntities = [
      {
        type: "rampSchedule" as const,
        id: "rs_8f2",
        name: "Checkout ramp",
        action: "step" as const,
        step: 3,
        steps: 5,
      },
    ];
    expect(build(featureUpdated({ relatedEntities }), "checkout-api")).toEqual({
      data: {
        type: "event",
        attributes: {
          category: "change",
          integration_id: "custom-events",
          title: "new-checkout-flow: Ramp step 3 of 5 (production)",
          timestamp: "2026-11-24T12:00:00.000Z",
          aggregation_key: "growthbook:feature:new-checkout-flow",
          tags: ["env:production", "service:checkout-api"],
          attributes: {
            changed_resource: {
              type: "feature_flag",
              name: "new-checkout-flow",
            },
            impacted_resources: [{ type: "service", name: "checkout-api" }],
            author: { type: "automation", name: "Ramp schedule" },
            prev_value: {
              defaultValue: "false",
              environments: {
                production: {
                  enabled: true,
                  rules: [
                    {
                      id: "fr_1",
                      type: "rollout",
                      coverage: 0.2,
                      value: "true",
                    },
                  ],
                },
              },
            },
            new_value: {
              defaultValue: "false",
              environments: {
                production: {
                  enabled: true,
                  rules: [
                    {
                      id: "fr_1",
                      type: "rollout",
                      coverage: 0.4,
                      value: "true",
                    },
                  ],
                },
              },
            },
            change_metadata: {
              resource_link: `${origin}/features/new-checkout-flow?v=14`,
              revision: { version: 14, comment: "Ramp step 3 of 5" },
              project: "prj_checkout",
              flag_tags: ["checkout"],
              request_source: "system",
              related: relatedEntities,
              related_total: 1,
            },
          },
        },
      },
    });
  });

  it("titles an environment toggle by its revision and credits the user", () => {
    const event = build(
      featureUpdated({
        user: {
          type: "dashboard",
          id: "u_1",
          email: "dev@example.com",
          name: "Dev",
        },
        data: {
          object: flag({
            revision: { version: 15, comment: "Turn off in production" },
          }),
          previous_attributes: {
            revision: { version: 14, comment: "" },
            environments: {
              production: { enabled: false, rules: [] },
            },
          },
        },
      }),
    );
    expect(event.data).toMatchObject({
      attributes: {
        title: "new-checkout-flow: Turn off in production (production)",
        attributes: {
          author: { type: "user", name: "dev@example.com" },
          prev_value: {
            environments: { production: { enabled: false, rules: [] } },
          },
        },
      },
    });
  });

  it("shows a default value change in every environment", () => {
    const event = build(
      featureUpdated({
        environments: ["production", "staging"],
        data: {
          object: flag({ defaultValue: "true" }),
          previous_attributes: { defaultValue: "false" },
        },
      }),
    );
    expect(event.data).toMatchObject({
      attributes: {
        tags: ["env:production", "env:staging"],
        attributes: {
          prev_value: { defaultValue: "false" },
          new_value: { defaultValue: "true" },
        },
      },
    });
  });

  it("names experiments by tracking key", () => {
    const envelope: DatadogEnvelope = {
      event: "experiment.updated",
      created,
      projects: [],
      tags: [],
      environments: ["production"],
      user: {
        type: "dashboard",
        id: "u_1",
        email: "pm@example.com",
        name: "PM",
      },
      relatedEntities: [
        {
          type: "feature",
          id: "new-checkout-flow",
          environments: ["production"],
        },
      ],
      data: {
        object: {
          id: "exp_1",
          trackingKey: "checkout-test",
          name: "Checkout test",
          type: "standard",
          status: "running",
          phases: [{ coverage: 1 }],
        },
        previous_attributes: { status: "draft" },
      },
    };
    expect(build(envelope).data).toMatchObject({
      attributes: {
        title: "checkout-test: Started (production)",
        tags: ["env:production"],
        attributes: {
          changed_resource: { type: "feature_flag", name: "checkout-test" },
          prev_value: { status: "draft" },
          new_value: { status: "running" },
        },
      },
    });
  });

  it("shows a bandit's reweighting as its traffic split", () => {
    const split = (a: number, b: number) => [
      { variationId: "v0", weight: a },
      { variationId: "v1", weight: b },
    ];
    const envelope: DatadogEnvelope = {
      event: "experiment.updated",
      created,
      projects: [],
      tags: [],
      environments: ["production"],
      user: null,
      data: {
        object: {
          id: "exp_2",
          trackingKey: "hero-bandit",
          type: "multi-armed-bandit",
          status: "running",
          phases: [{ coverage: 1, trafficSplit: split(0.7, 0.3) }],
        },
        previous_attributes: {
          phases: [{ coverage: 1, trafficSplit: split(0.5, 0.5) }],
        },
      },
    };
    expect(build(envelope).data).toMatchObject({
      attributes: {
        title: "hero-bandit: Bandit reweighted (production)",
        attributes: {
          prev_value: { trafficSplit: split(0.5, 0.5) },
          new_value: { trafficSplit: split(0.7, 0.3) },
        },
      },
    });
  });

  it("sends a saved group's condition and member count, never its members", () => {
    const envelope: DatadogEnvelope = {
      event: "savedGroup.updated",
      created,
      projects: [],
      tags: [],
      environments: ["production"],
      user: { type: "api_key", apiKey: "key_1", name: "CI" },
      data: {
        object: {
          id: "grp_1",
          name: "Beta testers",
          attributeKey: "id",
          values: ["a", "b", "c"],
        },
        previous_attributes: { values: ["a", "b"] },
      },
    };
    const event = build(envelope);
    expect(event.data).toMatchObject({
      attributes: {
        title: "Beta testers: Updated (production)",
        attributes: {
          changed_resource: { type: "configuration", name: "Beta testers" },
          author: { type: "api", name: "CI (API)" },
          prev_value: { attributeKey: "id", members: 2 },
          new_value: { attributeKey: "id", members: 3 },
        },
      },
    });
    expect(JSON.stringify(event)).not.toContain('"a"');
  });

  it("caps the related entities it lists", () => {
    const relatedEntities = Array.from({ length: 150 }, (_, i) => ({
      type: "feature" as const,
      id: `flag-${i}`,
      environments: ["production"],
    }));
    const metadata = (
      build(
        featureUpdated({ event: "savedGroup.updated", relatedEntities }),
      ) as {
        data: {
          attributes: {
            attributes: {
              change_metadata: { related: unknown[]; related_total: number };
            };
          };
        };
      }
    ).data.attributes.attributes.change_metadata;
    expect(metadata.related).toHaveLength(100);
    expect(metadata.related_total).toBe(150);
  });

  it("lists who approved the revision", () => {
    const metadata = (envelope: DatadogEnvelope) =>
      (
        build(envelope) as {
          data: { attributes: { attributes: { change_metadata: object } } };
        }
      ).data.attributes.attributes.change_metadata;
    expect(
      metadata(
        featureUpdated({
          approvers: [{ id: "u_2", email: "lead@example.com", name: "Lead" }],
        }),
      ),
    ).toHaveProperty("approved_by", ["Lead"]);
    expect(metadata(featureUpdated())).not.toHaveProperty("approved_by");
  });
});

describe("servedEnvironments", () => {
  const deleted = (object: Record<string, unknown>) =>
    featureUpdated({
      event: "feature.deleted",
      environments: ["production", "staging"],
      data: { object: flag(object) },
    });

  it("lists a deleted flag only where it was served", () => {
    expect(
      servedEnvironments(
        deleted({
          environments: {
            production: { enabled: true, rules: [] },
            staging: { enabled: false, rules: [] },
          },
        }),
      ),
    ).toEqual(["production"]);
    expect(servedEnvironments(deleted({ archived: true }))).toEqual([]);
  });

  it("keeps other events' environments", () => {
    expect(
      servedEnvironments(
        featureUpdated({ environments: ["production", "staging"] }),
      ),
    ).toEqual(["production", "staging"]);
  });
});

describe("getDatadogNotificationPayload", () => {
  const webhook = (
    overrides: Partial<
      Parameters<typeof getDatadogNotificationPayload>[0]["eventWebHook"]
    > = {},
  ) => ({ projects: [], tags: [], environments: [], ...overrides });
  const asEvent = (envelope: DatadogEnvelope) =>
    ({
      id: "event-1",
      organizationId: "org",
      dateCreated: new Date(created),
      version: 1,
      event: envelope.event,
      data: envelope,
    }) as unknown as EventInterface;

  it("skips changes with no environments left after the webhook's filter", () => {
    expect(
      getDatadogNotificationPayload({
        event: asEvent(featureUpdated({ environments: [] })),
        eventWebHook: webhook(),
      }),
    ).toBeNull();
    expect(
      getDatadogNotificationPayload({
        event: asEvent(featureUpdated()),
        eventWebHook: webhook({ environments: ["staging"] }),
      }),
    ).toBeNull();
  });

  it("skips events Datadog doesn't support", () => {
    expect(
      getDatadogNotificationPayload({
        event: asEvent({ ...featureUpdated(), event: "user.login" }),
        eventWebHook: webhook(),
      }),
    ).toBeNull();
  });

  it("sends test events as a change with no service", () => {
    expect(
      getDatadogNotificationPayload({
        event: asEvent({
          ...featureUpdated(),
          event: "webhook.test",
          data: { object: { webhookId: "ewh_1" } },
        }),
        eventWebHook: webhook({ environments: ["production"] }),
      }),
    ).toMatchObject({
      data: {
        attributes: {
          category: "change",
          attributes: {
            changed_resource: { type: "feature_flag", name: "growthbook-test" },
          },
        },
      },
    });
  });

  it("tags changes with the webhook's service", () => {
    expect(
      getDatadogNotificationPayload({
        event: asEvent(featureUpdated()),
        eventWebHook: webhook({ datadog: { service: " Checkout-API " } }),
      }),
    ).toMatchObject({
      data: {
        attributes: {
          tags: ["env:production", "service:checkout-api"],
          attributes: {
            impacted_resources: [{ type: "service", name: "checkout-api" }],
          },
        },
      },
    });
  });

  it("tags a shared change with where its dependents in the webhook's scope changed", () => {
    const savedGroupUpdated = featureUpdated({
      event: "savedGroup.updated",
      projects: [],
      tags: [],
      environments: ["production", "staging"],
      data: { object: { id: "grp_1", name: "Beta testers" } },
      relatedEntities: [
        {
          type: "feature",
          id: "new-checkout-flow",
          environments: ["production"],
          projects: ["prj_checkout"],
          tags: ["checkout"],
        },
        {
          type: "feature",
          id: "search-ranking",
          environments: ["production", "staging"],
          projects: ["prj_search"],
          tags: ["search"],
        },
      ],
    });
    expect(
      getDatadogNotificationPayload({
        event: asEvent(savedGroupUpdated),
        eventWebHook: webhook({ projects: ["prj_checkout"] }),
      }),
    ).toMatchObject({ data: { attributes: { tags: ["env:production"] } } });
  });
});
