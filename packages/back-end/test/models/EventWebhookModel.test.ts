import {
  EventWebHookModel,
  getAllEventWebHooksForEvent,
} from "../../src/models/EventWebhookModel";

describe("getAllEventWebHooksForEvent", () => {
  describe("when event has no projects", () => {
    it("implements the right logic", async () => {
      jest.spyOn(EventWebHookModel, "find").mockImplementation(() => [
        {
          toJSON: () => ({ name: "webhook with no filter on projects" }),
          type: "raw",
          projects: [],
        },
        {
          toJSON: () => ({ name: "webhook with filter for event project" }),
          type: "raw",
          projects: ["event project"],
        },
        {
          toJSON: () => ({ name: "webhook with filter for foo project" }),
          type: "raw",
          projects: ["foo"],
        },
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
        {
          name: "webhook with no filter on projects",
          environments: [],
          projects: [],
          tags: [],
          headers: {},
          method: "POST",
          type: "raw",
        },
      ]);
    });
  });

  describe("when event has projects", () => {
    it("implements the right logic", async () => {
      jest.spyOn(EventWebHookModel, "find").mockImplementation(() => [
        {
          toJSON: () => ({ name: "webhook with no filter on projects" }),
          type: "raw",
          projects: [],
        },
        {
          toJSON: () => ({ name: "webhook with filter for event project" }),
          type: "raw",
          projects: ["event project"],
        },
        {
          toJSON: () => ({ name: "webhook with filter for foo projects" }),
          type: "raw",
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
      expect(ret).toEqual([
        {
          name: "webhook with no filter on projects",
          environments: [],
          projects: [],
          tags: [],
          headers: {},
          method: "POST",
          type: "raw",
        },
        {
          name: "webhook with filter for event project",
          environments: [],
          projects: ["event project"],
          tags: [],
          headers: {},
          method: "POST",
          type: "raw",
        },
      ]);
    });
  });
});
