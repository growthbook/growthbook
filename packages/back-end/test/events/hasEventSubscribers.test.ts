import { setupApp } from "back-end/test/api/api.setup";
import { hasEventSubscribers } from "back-end/src/events/hasEventSubscribers";
import {
  createEventWebHook,
  getAllEventWebHooksForEvent,
} from "back-end/src/models/EventWebhookModel";
import {
  createSlackIntegration,
  getSlackIntegrationsForFilters,
} from "back-end/src/models/SlackIntegrationModel";

jest.mock("back-end/src/models/EventWebhookModel", () => ({
  ...jest.requireActual("back-end/src/models/EventWebhookModel"),
  getAllEventWebHooksForEvent: jest.fn(
    jest.requireActual("back-end/src/models/EventWebhookModel")
      .getAllEventWebHooksForEvent,
  ),
}));
jest.mock("back-end/src/models/SlackIntegrationModel", () => ({
  ...jest.requireActual("back-end/src/models/SlackIntegrationModel"),
  getSlackIntegrationsForFilters: jest.fn(
    jest.requireActual("back-end/src/models/SlackIntegrationModel")
      .getSlackIntegrationsForFilters,
  ),
}));

const { isReady } = setupApp();
beforeEach(async () => {
  await isReady;
});

const filters = {
  organizationId: "org-subscribers",
  eventName: "experiment.info.significance",
  projects: ["checkout"],
  tags: ["revenue"],
  environments: ["production"],
} satisfies Parameters<typeof hasEventSubscribers>[0];

async function webhook(
  overrides: Partial<Parameters<typeof createEventWebHook>[0]> = {},
) {
  await createEventWebHook({
    organizationId: filters.organizationId,
    name: "Subscription test",
    url: "http://localhost/unused",
    enabled: true,
    events: ["experiment.info.significance"],
    projects: [],
    tags: [],
    environments: [],
    payloadType: "json",
    method: "POST",
    headers: {},
    ...overrides,
  });
}

async function slack(
  overrides: Partial<Parameters<typeof createSlackIntegration>[0]> = {},
) {
  await createSlackIntegration({
    organizationId: filters.organizationId,
    name: "Legacy Slack subscription",
    description: "",
    projects: [],
    environments: [],
    events: [],
    tags: [],
    slackAppId: "test",
    slackIncomingWebHook: "http://localhost/unused",
    slackSigningKey: "test",
    linkedByUserId: "test",
    ...overrides,
  });
}

it("skips dispatch when neither subscription system has a consumer", async () => {
  expect(await hasEventSubscribers(filters)).toBe(false);
});

it.each<Partial<Parameters<typeof createEventWebHook>[0]>>([
  {},
  { events: ["experiment.*"] },
  { projects: ["checkout"], tags: ["revenue"], environments: ["production"] },
  { payloadType: "slack" },
  { payloadType: "discord" },
])("keeps matching webhooks: %j", async (overrides) => {
  await webhook(overrides);
  expect(await hasEventSubscribers(filters)).toBe(true);
});

it.each<Partial<Parameters<typeof createEventWebHook>[0]>>([
  { enabled: false },
  { events: ["feature.*"] },
  { organizationId: "another-org" },
  { projects: ["another-project"] },
  { tags: ["another-tag"] },
  { environments: ["staging"] },
])("ignores non-matching webhooks: %j", async (overrides) => {
  await webhook(overrides);
  expect(await hasEventSubscribers(filters)).toBe(false);
});

it.each<Partial<Parameters<typeof createSlackIntegration>[0]>>([
  {},
  { events: ["experiment.info.significance"] },
  { events: ["experiment.*"] },
])(
  "keeps legacy Slack subscriptions, including empty event lists: %j",
  async (overrides) => {
    await slack(overrides);
    expect(await hasEventSubscribers(filters)).toBe(true);
  },
);

it("applies legacy Slack routing filters", async () => {
  await slack({ events: ["feature.*"] });
  await slack({ organizationId: "another-org" });
  await slack({ projects: ["another-project"] });
  await slack({ tags: ["another-tag"] });
  await slack({ environments: ["staging"] });
  expect(await hasEventSubscribers(filters)).toBe(false);
});

it("does not match environment-scoped subscriptions for an unscoped event", async () => {
  await webhook({ environments: ["production"] });
  await slack({ environments: ["production"] });
  expect(await hasEventSubscribers({ ...filters, environments: [] })).toBe(
    false,
  );
});

it("rechecks new subscriptions without caching a negative result", async () => {
  expect(await hasEventSubscribers(filters)).toBe(false);
  await webhook();
  expect(await hasEventSubscribers(filters)).toBe(true);
});

it("keeps dispatching if either subscription lookup fails", async () => {
  jest.mocked(getSlackIntegrationsForFilters).mockResolvedValueOnce(null);
  expect(await hasEventSubscribers(filters)).toBe(true);
  jest
    .mocked(getAllEventWebHooksForEvent)
    .mockRejectedValueOnce(new Error("Injected lookup failure"));
  expect(await hasEventSubscribers(filters)).toBe(true);
});
