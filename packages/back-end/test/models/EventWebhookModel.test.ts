import {
  EventWebHookModel,
  getAllEventWebHooksForEvent,
} from "back-end/src/models/EventWebhookModel";

describe("getAllEventWebHooksForEvent", () => {
  it("queries the webhooks subscribed to the event or a wildcard", async () => {
    jest.spyOn(EventWebHookModel, "find").mockImplementation(() => [
      {
        toJSON: () => ({ name: "webhook", projects: ["foo"] }),
        projects: ["foo"],
      },
    ]);

    const ret = await getAllEventWebHooksForEvent({
      organizationId: "aabb",
      eventName: "feature.created",
      enabled: true,
    });

    expect(EventWebHookModel.find).toHaveBeenCalledWith({
      enabled: true,
      events: { $in: ["feature.created", "*", "feature.*"] },
      organizationId: "aabb",
    });
    expect(ret).toEqual([
      {
        name: "webhook",
        environments: [],
        projects: ["foo"],
        tags: [],
        headers: {},
        method: "POST",
        payloadType: "raw",
      },
    ]);
  });

  describe("when event is a 3-part name (e.g. feature.revision.created)", () => {
    it("includes both the 1-part and 2-part wildcard patterns", async () => {
      jest.spyOn(EventWebHookModel, "find").mockImplementation(() => []);

      await getAllEventWebHooksForEvent({
        organizationId: "aabb",
        eventName: "feature.revision.created",
        enabled: true,
      });

      expect(EventWebHookModel.find).toHaveBeenCalledWith({
        enabled: true,
        events: {
          $in: [
            "feature.revision.created",
            "*",
            "feature.*",
            "feature.revision.*",
          ],
        },
        organizationId: "aabb",
      });
    });
  });
});
