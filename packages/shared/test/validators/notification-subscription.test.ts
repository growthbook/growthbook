import {
  notificationFiltersSchema,
  notificationDeliverySchema,
  eventWebHookInterface,
  eventWebHookRequestBodySchema,
  slackNotificationSettingsBodySchema,
} from "../../src/validators/event-webhook";

const subscription = {
  events: [
    "experiment.*",
    "feature.revision.*",
    "savedGroup.revision.published",
  ],
  projects: [],
  tags: [],
  environments: [],
  experimentIds: ["exp_1"],
  metricIds: ["fact__revenue"],
  featureIds: ["checkout"],
};
it("validates subscription criteria independently of delivery settings", () => {
  expect(notificationFiltersSchema.parse(subscription)).toEqual(subscription);
  expect(
    notificationFiltersSchema.safeParse({
      ...subscription,
      payloadType: "slack",
    }).success,
  ).toBe(false);
});
it.each([
  { events: [] },
  { events: ["experiment.notARealEvent"] },
  { metricIds: "fact__revenue" },
])("rejects invalid criteria %j", (invalid) => {
  expect(
    notificationFiltersSchema.safeParse({ ...subscription, ...invalid })
      .success,
  ).toBe(false);
});
it("keeps resource filters optional for existing subscriptions", () => {
  const existing = {
    events: ["feature.*"],
    projects: [],
    tags: [],
    environments: [],
  };
  expect(notificationFiltersSchema.parse(existing)).toEqual(existing);
});

it("composes filtering and delivery into a flat stored configuration", () => {
  const webhook = {
    ...subscription,
    id: "ewh_1",
    organizationId: "org_1",
    dateCreated: new Date(),
    dateUpdated: new Date(),
    name: "Notifications",
    enabled: true,
    excludeBookkeepingUpdates: true,
    signingKey: "secret",
    lastRunAt: null,
    lastState: "none",
    lastResponseBody: null,
    url: "https://slack.com",
    payloadType: "slack",
    method: "POST",
    headers: {},
    slack: { teamId: "T1", channelId: "C1" },
    notificationSettings: { type: "image", cardFormat: "compact" },
  };
  expect(eventWebHookInterface.parse(webhook)).toEqual(webhook);
  const { excludeBookkeepingUpdates, ...existingWebhook } = webhook;
  expect(excludeBookkeepingUpdates).toBe(true);
  expect(eventWebHookInterface.parse(existingWebhook)).toEqual(existingWebhook);
  expect(
    notificationDeliverySchema.parse({
      url: webhook.url,
      payloadType: webhook.payloadType,
      method: webhook.method,
      headers: webhook.headers,
    }),
  ).not.toHaveProperty("excludeBookkeepingUpdates");
});

it("keeps webhook requests restricted to their existing editable fields", () => {
  const request = {
    ...subscription,
    name: "Notifications",
    enabled: true,
    url: "https://example.com/webhook",
    payloadType: "json",
    method: "POST",
    headers: {},
  };
  expect(eventWebHookRequestBodySchema.parse(request)).toEqual(request);
  for (const restricted of [
    { signingKey: "secret" },
    { slack: {} },
    { notificationSettings: { type: "text" } },
  ]) {
    expect(
      eventWebHookRequestBodySchema.safeParse({ ...request, ...restricted })
        .success,
    ).toBe(false);
  }
  expect(
    slackNotificationSettingsBodySchema.parse({
      ...subscription,
      enabled: true,
      notificationSettings: { type: "text" },
    }),
  ).toEqual({
    ...subscription,
    enabled: true,
    notificationSettings: { type: "text" },
  });
  expect(
    slackNotificationSettingsBodySchema.safeParse({
      ...subscription,
      enabled: true,
      url: request.url,
    }).success,
  ).toBe(false);
});

it.each([true, false])(
  "rejects client-supplied bookkeeping policy %s for webhook and Slack settings",
  (excludeBookkeepingUpdates) => {
    const filters = { ...subscription, excludeBookkeepingUpdates };
    expect(notificationFiltersSchema.safeParse(filters).success).toBe(false);
    expect(
      eventWebHookRequestBodySchema.safeParse({
        ...filters,
        name: "Notifications",
        enabled: true,
        url: "https://example.com/webhook",
        payloadType: "json",
        method: "POST",
        headers: {},
      }).success,
    ).toBe(false);
    expect(
      slackNotificationSettingsBodySchema.safeParse({
        ...filters,
        enabled: true,
        notificationSettings: { type: "text" },
      }).success,
    ).toBe(false);
  },
);
