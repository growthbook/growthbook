import type { ExperimentInterface } from "shared/types/experiment";
import type { ExperimentSnapshotInterface } from "shared/types/experiment-snapshot";
import type { Context } from "back-end/src/models/BaseModel";
import {
  memoizeNotification,
  notifyNoData,
} from "back-end/src/services/experimentNotifications";
import { setExperimentNotificationState } from "back-end/src/models/ExperimentModel";

jest.mock("back-end/src/models/ExperimentModel", () => ({
  setExperimentNotificationState: jest.fn(),
}));

jest.mock("back-end/src/models/EventModel", () => ({
  createEvent: jest.fn(),
}));

jest.mock("back-end/src/services/owner", () => ({
  getOwnerEmail: jest.fn(),
}));

describe("memoizeNotification", () => {
  it("calls the handler when notification is triggered and hasn't been dispatched yet", async () => {
    const dispatch = jest.fn();
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
    const dispatch = jest.fn();
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
    const dispatch = jest.fn();
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
    const dispatch = jest.fn();
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

describe("notifyNoData", () => {
  const HOUR = 60 * 60 * 1000;

  const makeContext = (noDataAlertGracePeriodHours?: number) =>
    ({
      org: { id: "org_1", settings: { noDataAlertGracePeriodHours } },
    }) as unknown as Context;

  const makeExperiment = (phaseAgesHours: number[]) =>
    ({
      id: "exp_1",
      name: "Exp",
      pastNotifications: [],
      phases: phaseAgesHours.map((h) => ({
        dateStarted: new Date(Date.now() - h * HOUR),
      })),
    }) as unknown as ExperimentInterface;

  const emptySnapshot = (phase = 0) =>
    ({
      status: "success",
      phase,
      settings: {},
      analyses: [{ settings: {}, results: [{ variations: [] }] }],
    }) as unknown as ExperimentSnapshotInterface;

  beforeEach(() => jest.clearAllMocks());

  it("stays quiet inside the default 24h grace period", async () => {
    await expect(
      notifyNoData({
        context: makeContext(),
        experiment: makeExperiment([2]),
        snapshot: emptySnapshot(),
      }),
    ).resolves.toBe(false);
    expect(setExperimentNotificationState).not.toHaveBeenCalled();
  });

  it("fires once the phase is older than the grace period", async () => {
    await expect(
      notifyNoData({
        context: makeContext(),
        experiment: makeExperiment([25]),
        snapshot: emptySnapshot(),
      }),
    ).resolves.toBe(true);
  });

  it("fires immediately when the grace period is 0", async () => {
    await expect(
      notifyNoData({
        context: makeContext(0),
        experiment: makeExperiment([0.1]),
        snapshot: emptySnapshot(),
      }),
    ).resolves.toBe(true);
  });

  it("measures grace from the snapshot's phase, not the latest phase", async () => {
    await expect(
      notifyNoData({
        context: makeContext(24),
        experiment: makeExperiment([48, 1]),
        snapshot: emptySnapshot(0),
      }),
    ).resolves.toBe(true);
  });
});
