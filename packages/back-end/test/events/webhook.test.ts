import { describe, it, expect, vi } from "vitest";
import { setupApp } from "back-end/test/api/api.setup";
import { EventNotifier } from "back-end/src/events/notifiers/EventNotifier";
import {
  EventWebHookModel,
  sendEventWebhookTestEvent,
} from "back-end/src/models/EventWebhookModel";
import { EventModel } from "back-end/src/models/EventModel";

vi.mock("back-end/src/models/EventWebhookModel", () => ({
  ...vi.importActual("back-end/src/models/EventWebhookModel"),
  getEventWebHookById: vi.fn(),
}));

vi.mock("back-end/src/events/notifiers/EventNotifier", () => ({
  EventNotifier: vi.fn(),
}));

const mockEventNotifier = vi.mocked(EventNotifier);

describe("webhook test events", () => {
  setupApp();

  const org = { id: "org", environments: [{ id: "production" }] };

  it("dispatches webhook test events", async () => {
    vi.spyOn(EventWebHookModel, "findOne").mockReturnValue({
      toJSON: () => ({ id: "webhook-aabb" }),
    });

    const mockNotifier = { perform: vi.fn() };
    mockEventNotifier.mockReturnValue(mockNotifier);

    const eventModelCreate = vi.spyOn(EventModel, "create");

    await sendEventWebhookTestEvent(
      {
        permissions: { canCreateEventWebhook: () => true },
        org,
      },
      "webhook-aabb"
    );

    expect(eventModelCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          api_version: expect.any(String),
          containsSecrets: false,
          created: expect.any(Number),
          data: { object: { webhookId: "webhook-aabb" } },
          environments: [],
          event: "webhook.test",
          object: "webhook",
          projects: [],
          tags: [],
          user: null,
        },
        dateCreated: expect.any(Date),
        event: "webhook.test",
        id: expect.any(String),
        object: "webhook",
        objectId: "webhook-aabb",
        organizationId: "org",
        version: 1,
      })
    );
    expect(EventNotifier).toHaveBeenCalledWith(
      eventModelCreate.mock.calls[0][0].id
    );
    expect(mockNotifier.perform).toHaveBeenCalled();
  });
});
