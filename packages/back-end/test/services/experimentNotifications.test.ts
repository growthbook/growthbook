import { vi } from "vitest";
import { memoizeNotification } from "back-end/src/services/experimentNotifications";
import { setExperimentNotificationState } from "back-end/src/models/ExperimentModel";

vi.mock("back-end/src/models/ExperimentModel", () => ({
  setExperimentNotificationState: vi.fn(),
}));

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
    expect(setExperimentNotificationState).toHaveBeenCalledWith({
      type: "foo",
      triggered: true,
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
    expect(setExperimentNotificationState).not.toHaveBeenCalledWith();
  });

  it("clears the marker without dispatching when a sent notification ends", async () => {
    const dispatch = vi.fn();
    await expect(
      memoizeNotification({
        context: "da-context",
        experiment: { id: "da-experiment", pastNotifications: ["foo", "bla"] },
        type: "foo",
        triggered: false,
        dispatch,
      }),
    ).resolves.toBe(false);

    expect(dispatch).not.toHaveBeenCalled();
    expect(setExperimentNotificationState).toHaveBeenCalledWith({
      type: "foo",
      triggered: false,
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
    expect(setExperimentNotificationState).not.toHaveBeenCalledWith();
  });
});
