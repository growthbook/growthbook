import { EventInterface } from "shared/types/events/event";
import { EventWebHookInterface } from "shared/types/event-webhook";
import { shouldCoalesceWebhook } from "back-end/src/events/handlers/webhooks/webHooksEventHandler";

const makeWebhook = (
  overrides: Partial<EventWebHookInterface> = {},
): EventWebHookInterface =>
  ({
    id: "ewh_1",
    organizationId: "org_1",
    name: "Slack webhook",
    url: "https://hooks.example/abc",
    enabled: true,
    events: ["experiment.*"],
    projects: [],
    tags: [],
    environments: [],
    payloadType: "slack",
    method: "POST",
    headers: {},
    signingKey: "sk",
    lastState: "none",
    dateCreated: new Date(),
    dateUpdated: new Date(),
    lastRunAt: null,
    lastResponseBody: null,
    coalesceWindowMs: 15_000,
    ...overrides,
  }) as unknown as EventWebHookInterface;

const makeEvent = (overrides: Partial<EventInterface> = {}): EventInterface =>
  ({
    id: "event-1",
    version: 1,
    event: "experiment.updated",
    dateCreated: new Date(),
    organizationId: "org_1",
    object: "experiment",
    objectId: "exp_abc",
    data: { data: { object: { id: "exp_abc" } } },
    ...overrides,
  }) as unknown as EventInterface;

describe("shouldCoalesceWebhook", () => {
  it("coalesces a Slack webhook with a positive window", () => {
    expect(shouldCoalesceWebhook(makeWebhook(), makeEvent())).toBe(true);
  });

  it("coalesces Discord webhooks too", () => {
    expect(
      shouldCoalesceWebhook(
        makeWebhook({ payloadType: "discord" }),
        makeEvent(),
      ),
    ).toBe(true);
  });

  it("does not coalesce raw or json webhooks (API consumers expect 1:1)", () => {
    expect(
      shouldCoalesceWebhook(makeWebhook({ payloadType: "raw" }), makeEvent()),
    ).toBe(false);
    expect(
      shouldCoalesceWebhook(makeWebhook({ payloadType: "json" }), makeEvent()),
    ).toBe(false);
  });

  it("does not coalesce when coalesceWindowMs is 0 or undefined", () => {
    expect(
      shouldCoalesceWebhook(makeWebhook({ coalesceWindowMs: 0 }), makeEvent()),
    ).toBe(false);
    expect(
      shouldCoalesceWebhook(
        makeWebhook({ coalesceWindowMs: undefined }),
        makeEvent(),
      ),
    ).toBe(false);
  });

  it("does not coalesce events with no objectId (e.g. user.login)", () => {
    expect(
      shouldCoalesceWebhook(makeWebhook(), makeEvent({ objectId: undefined })),
    ).toBe(false);
  });

  it("does not coalesce webhook.test events (admins want instant feedback)", () => {
    expect(
      shouldCoalesceWebhook(
        makeWebhook(),
        makeEvent({ event: "webhook.test", objectId: "ewh_1" }),
      ),
    ).toBe(false);
  });
});
