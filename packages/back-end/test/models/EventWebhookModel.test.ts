import { EventWebHookModel } from "../../src/models/EventWebHookModel";
import { BaseModel } from "../../src/models/BaseModel";

class TestModel extends EventWebHookModel {
  public addIndexes() {}
}

describe("getAllEventWebHooksForEvent", () => {
  describe("when event has no projects", () => {
    it("implements the right logic", async () => {
      const model = new TestModel();

      jest.spyOn(BaseModel.prototype, "_find").mockImplementation(() => [
        {
          name: "webhook with no filter on projects",
          projects: [],
        },
        {
          name: "webhook with filter for event project",
          projects: ["event project"],
        },
        {
          name: "webhook with filter for foo project",
          projects: ["foo"],
        },
      ]);

      const ret = await model.getAllForEvent({
        eventName: "feature.created",
        enabled: true,
        tags: [],
        projects: [],
      });

      expect(BaseModel.prototype._find).toHaveBeenCalledWith({
        enabled: true,
        events: "feature.created",
      });
      expect(ret).toEqual([
        { name: "webhook with no filter on projects", projects: [] },
      ]);
    });
  });

  describe("when event has projects", () => {
    it("implements the right logic", async () => {
      const model = new TestModel();

      jest.spyOn(BaseModel.prototype, "_find").mockImplementation(() => [
        {
          name: "webhook with no filter on projects",
          projects: [],
        },
        {
          name: "webhook with filter for event project",
          projects: ["event project"],
        },
        {
          name: "webhook with filter for foo projects",
          projects: ["foo"],
        },
      ]);

      const ret = await model.getAllForEvent({
        eventName: "feature.created",
        enabled: true,
        tags: [],
        projects: ["event project"],
      });

      expect(BaseModel.prototype._find).toHaveBeenCalledWith({
        enabled: true,
        events: "feature.created",
      });
      expect(ret).toEqual([
        { name: "webhook with no filter on projects", projects: [] },
        {
          name: "webhook with filter for event project",
          projects: ["event project"],
        },
      ]);
    });
  });
});
