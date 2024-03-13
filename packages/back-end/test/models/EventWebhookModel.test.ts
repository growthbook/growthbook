import {
  EventWebHookModel,
  getAllEventWebHooksForEvent,
} from "@/src/models/EventWebhookModel";

describe("getAllEventWebHooksForEvent", () => {
  describe("when event has no projects", () => {
    it("implements the right logic", async () => {
      jest.spyOn(EventWebHookModel, "find").mockImplementation(() => [
        { toJSON: () => ({ name: "doc with no projects" }), projects: [] },
        {
          toJSON: () => ({ name: "doc with event project" }),
          projects: ["event project"],
        },
        { toJSON: () => ({ name: "doc with foo project" }), projects: ["foo"] },
      ]);

      const ret = await getAllEventWebHooksForEvent({
        organizationId: "aabb",
        eventName: "feature.created",
        enabled: true,
        tags: [],
        projects: [],
      });

      expect(EventWebHookModel.find).toHaveBeenCalledWith({
        enabled: true,
        events: "feature.created",
        organizationId: "aabb",
      });
      expect(ret).toEqual([
        { name: "doc with no projects" },
        { name: "doc with event project" },
        { name: "doc with foo project" },
      ]);
    });
  });

  describe("when event has projects", () => {
    it("implements the right logic", async () => {
      jest.spyOn(EventWebHookModel, "find").mockImplementation(() => [
        { toJSON: () => ({ name: "doc with no projects" }), projects: [] },
        {
          toJSON: () => ({ name: "doc with event project" }),
          projects: ["event project"],
        },
        {
          toJSON: () => ({ name: "doc with foo projects" }),
          projects: ["foo"],
        },
      ]);

      const ret = await getAllEventWebHooksForEvent({
        organizationId: "aabb",
        eventName: "feature.created",
        enabled: true,
        tags: [],
        projects: ["event project"],
      });

      expect(EventWebHookModel.find).toHaveBeenCalledWith({
        enabled: true,
        events: "feature.created",
        organizationId: "aabb",
      });
      expect(ret).toEqual([{ name: "doc with event project" }]);
    });
  });
});
