import type { EventInterface } from "shared/types/events/event";
import { getEventWebhookPayload } from "back-end/src/services/notifications/deliverEventNotification";

const date = new Date("2026-09-15T00:00:00Z");
const legacyEvent = {
  id: "event-1",
  organizationId: "org-1",
  dateCreated: date,
  version: undefined,
  event: "webhook.test",
  data: {
    event: "webhook.test",
    object: "webhook",
    data: { webhookId: "webhook-1" },
    user: { type: "system" },
    projects: ["project-1"],
    environments: ["production"],
    tags: ["checkout"],
    containsSecrets: false,
  },
} satisfies EventInterface;
const event = {
  ...legacyEvent,
  version: 1,
  data: {
    ...legacyEvent.data,
    data: { object: { webhookId: "webhook-1" } },
    api_version: "2024-07-31",
    created: date.getTime(),
  },
} satisfies EventInterface;

it("preserves the full versioned JSON envelope", async () => {
  expect(await getEventWebhookPayload({ event, payloadType: "json" })).toEqual(
    event.data,
  );
});

it("converts versioned raw payloads to the legacy shape", async () => {
  expect(await getEventWebhookPayload({ event, payloadType: "raw" })).toEqual(
    legacyEvent.data,
  );
});

it("preserves unversioned raw payloads", async () => {
  expect(
    await getEventWebhookPayload({ event: legacyEvent, payloadType: "raw" }),
  ).toEqual(legacyEvent.data);
});

it.each([event, legacyEvent])(
  "preserves Discord's content-only payload for event version $version",
  async (event) => {
    expect(
      await getEventWebhookPayload({ event, payloadType: "discord" }),
    ).toEqual({ content: "This is a test event for webhook webhook-1" });
  },
);

it("rejects JSON delivery of unversioned events", async () => {
  await expect(
    getEventWebhookPayload({ event: legacyEvent, payloadType: "json" }),
  ).rejects.toThrow("Internal error");
});

it("skips Discord events unsupported by its formatter", async () => {
  const loginEvent: EventInterface = {
    ...event,
    event: "user.login",
    data: {
      ...event.data,
      event: "user.login",
      object: "user",
      data: {
        object: {
          id: "user-1",
          email: "user@example.com",
          name: "Test user",
          device: "desktop",
          userAgent: "test",
          ip: "127.0.0.1",
          os: "test",
        },
      },
    },
  };
  expect(
    await getEventWebhookPayload({ event: loginEvent, payloadType: "discord" }),
  ).toBeNull();
});
