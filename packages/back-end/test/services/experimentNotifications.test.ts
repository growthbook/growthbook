import { describe, it, expect, vi } from "vitest";
import { memoizeNotification } from "back-end/src/services/experimentNotifications";
import { updateExperiment } from "back-end/src/models/ExperimentModel";

vi.mock("back-end/src/models/ExperimentModel", () => ({
  updateExperiment: vi.fn(),
}));

const mockUpdateExperiment = vi.mocked(updateExperiment);

describe("memoizeNotification", () => {
  it("calls the handler when notification is triggered and hasn't been dispatched yet", async () => {
    const dispatch = vi.fn();
    await memoizeNotification({
      context: "da-context",
      experiment: { id: "da-experiment" },
      type: "foo",
      triggered: true,
      dispatch,
    });

    expect(dispatch).toHaveBeenCalled();
    expect(mockUpdateExperiment).toHaveBeenCalledWith({
      changes: { pastNotifications: ["foo"] },
      context: "da-context",
      experiment: { id: "da-experiment" },
    });
  });

  it("does not call the handler when notification is triggered and it already has been dispatched", async () => {
    const dispatch = vi.fn();
    await memoizeNotification({
      context: "da-context",
      experiment: { id: "da-experiment", pastNotifications: ["foo"] },
      type: "foo",
      triggered: true,
      dispatch,
    });

    expect(dispatch).not.toHaveBeenCalled();
    expect(mockUpdateExperiment).not.toHaveBeenCalledWith();
  });

  it("calls the handler when notification is not triggered and it was previously dispatched", async () => {
    const dispatch = vi.fn();
    await memoizeNotification({
      context: "da-context",
      experiment: { id: "da-experiment", pastNotifications: ["foo", "bla"] },
      type: "foo",
      triggered: false,
      dispatch,
    });

    expect(dispatch).toHaveBeenCalled();
    expect(mockUpdateExperiment).toHaveBeenCalledWith({
      changes: { pastNotifications: ["bla"] },
      context: "da-context",
      experiment: { id: "da-experiment", pastNotifications: ["foo", "bla"] },
    });
  });

  it("does not call the handler when notification is not triggered and it was not previously dispatched", async () => {
    const dispatch = vi.fn();
    await memoizeNotification({
      context: "da-context",
      experiment: { id: "da-experiment", pastNotifications: ["bla"] },
      type: "foo",
      triggered: false,
      dispatch,
    });

    expect(dispatch).not.toHaveBeenCalled();
    expect(mockUpdateExperiment).not.toHaveBeenCalledWith();
  });
});
