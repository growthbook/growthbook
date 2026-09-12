import {
  memoizeNotification,
  notifyAutoUpdate,
} from "back-end/src/services/experimentNotifications";
import { updateExperiment } from "back-end/src/models/ExperimentModel";
import {
  createEvent,
  getLatestAutoUpdateFailEvent,
} from "back-end/src/models/EventModel";
import { getLatestSuccessfulSnapshot } from "back-end/src/models/ExperimentSnapshotModel";

jest.mock("back-end/src/models/ExperimentModel", () => ({
  updateExperiment: jest.fn(),
}));

jest.mock("back-end/src/models/EventModel", () => ({
  createEvent: jest.fn(),
  getLatestAutoUpdateFailEvent: jest.fn(),
}));

jest.mock("back-end/src/models/ExperimentSnapshotModel", () => ({
  getLatestSuccessfulSnapshot: jest.fn(),
}));

const createEventMock = createEvent as jest.Mock;
const getLatestAutoUpdateFailEventMock =
  getLatestAutoUpdateFailEvent as jest.Mock;
const getLatestSuccessfulSnapshotMock =
  getLatestSuccessfulSnapshot as jest.Mock;

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
    expect(updateExperiment).toHaveBeenCalledWith({
      changes: { pastNotifications: ["foo"] },
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
    expect(updateExperiment).not.toHaveBeenCalledWith();
  });

  it("calls the handler when notification is not triggered and it was previously dispatched", async () => {
    const dispatch = jest.fn();
    await memoizeNotification({
      context: "da-context",
      experiment: { id: "da-experiment", pastNotifications: ["foo", "bla"] },
      type: "foo",
      triggered: false,
      dispatch,
    });

    expect(dispatch).toHaveBeenCalled();
    expect(updateExperiment).toHaveBeenCalledWith({
      changes: { pastNotifications: ["bla"] },
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
    expect(updateExperiment).not.toHaveBeenCalledWith();
  });
});

describe("notifyAutoUpdate", () => {
  const failAt = new Date("2026-09-11T00:00:00.000Z");
  const context = { org: { id: "org_1" } };
  const experiment = {
    id: "exp_1",
    name: "Exp",
    archived: true,
    dateUpdated: new Date("2026-09-10T00:00:00.000Z"),
    phases: [{}],
  };

  beforeEach(() => {
    createEventMock.mockReset();
    getLatestAutoUpdateFailEventMock.mockReset();
    getLatestSuccessfulSnapshotMock.mockReset();
    getLatestAutoUpdateFailEventMock.mockResolvedValue(null);
    getLatestSuccessfulSnapshotMock.mockResolvedValue(null);
  });

  it("creates a warning event when there is no fail event", async () => {
    await notifyAutoUpdate({
      context,
      experiment,
      success: false,
    });

    expect(createEventMock).toHaveBeenCalled();
  });

  it("does not create a warning event when a fail event exists and Results have not worked since", async () => {
    getLatestAutoUpdateFailEventMock.mockResolvedValue({
      dateCreated: failAt,
    });

    await notifyAutoUpdate({
      context,
      experiment,
      success: false,
    });

    expect(createEventMock).not.toHaveBeenCalled();
  });

  it("creates a warning event when Results have worked since the fail event", async () => {
    getLatestAutoUpdateFailEventMock.mockResolvedValue({
      dateCreated: failAt,
    });
    getLatestSuccessfulSnapshotMock.mockResolvedValue({
      dateCreated: new Date("2026-09-12T00:00:00.000Z"),
    });

    await notifyAutoUpdate({
      context,
      experiment,
      success: false,
    });

    expect(createEventMock).toHaveBeenCalled();
  });

  it("does not create a warning event on success", async () => {
    await notifyAutoUpdate({
      context,
      experiment,
      success: true,
    });

    expect(getLatestAutoUpdateFailEventMock).not.toHaveBeenCalled();
    expect(createEventMock).not.toHaveBeenCalled();
  });
});
