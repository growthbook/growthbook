import {
  EventWebHookModel,
  getAllEventWebHooksForEvent,
} from "back-end/src/models/EventWebhookModel";

describe("getAllEventWebHooksForEvent", () => {
  describe("when event has no projects", () => {
    it("implements the right logic", async () => {
      jest.spyOn(EventWebHookModel, "find").mockImplementation(() => [
        {
          toJSON: () => ({ name: "webhook with no filter on projects" }),
          projects: [],
        },
        {
          toJSON: () => ({ name: "webhook with filter for event project" }),
          projects: ["event project"],
        },
        {
          toJSON: () => ({ name: "webhook with filter for foo project" }),
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
        events: { $in: ["feature.created", "feature.*"] },
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
          payloadType: "raw",
        },
      ]);
    });
  });

  describe("when event is a 3-part name (e.g. feature.revision.created)", () => {
    it("includes both the 1-part and 2-part wildcard patterns", async () => {
      jest.spyOn(EventWebHookModel, "find").mockImplementation(() => []);

      await getAllEventWebHooksForEvent({
        organizationId: "aabb",
        eventName: "feature.revision.created",
        enabled: true,
        tags: [],
        projects: [],
      });

      expect(EventWebHookModel.find).toHaveBeenCalledWith({
        enabled: true,
        events: {
          $in: ["feature.revision.created", "feature.*", "feature.revision.*"],
        },
        organizationId: "aabb",
      });
    });
  });

  describe("when event has projects", () => {
    it("implements the right logic", async () => {
      jest.spyOn(EventWebHookModel, "find").mockImplementation(() => [
        {
          toJSON: () => ({ name: "webhook with no filter on projects" }),
          projects: [],
        },
        {
          toJSON: () => ({
            name: "webhook with filter for event project",
            projects: ["event project"],
          }),
          projects: ["event project"],
        },
        {
          toJSON: () => ({
            name: "webhook with filter for foo projects",
            projects: ["foo"],
          }),
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
        events: { $in: ["feature.created", "feature.*"] },
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
          payloadType: "raw",
        },
        {
          name: "webhook with filter for event project",
          environments: [],
          projects: ["event project"],
          tags: [],
          headers: {},
          method: "POST",
          payloadType: "raw",
        },
      ]);
    });
  });
});
