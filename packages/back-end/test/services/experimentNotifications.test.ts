import {
  memoizeNotification,
  notifyAutoUpdate,
} from "back-end/src/services/experimentNotifications";
import { updateExperiment } from "back-end/src/models/ExperimentModel";
import {
  createEvent,
  hasAutoUpdateFailEventSince,
} from "back-end/src/models/EventModel";

jest.mock("back-end/src/models/ExperimentModel", () => ({
  updateExperiment: jest.fn(),
}));

jest.mock("back-end/src/models/EventModel", () => ({
  createEvent: jest.fn(),
  hasAutoUpdateFailEventSince: jest.fn(),
}));

const createEventMock = createEvent as jest.Mock;
const hasAutoUpdateFailEventSinceMock =
  hasAutoUpdateFailEventSince as jest.Mock;

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
  const dateUpdated = new Date("2026-09-11T00:00:00.000Z");
  const context = { org: { id: "org_1" } };
  const experiment = {
    id: "exp_1",
    name: "Exp",
    dateUpdated,
    archived: true,
  };

  beforeEach(() => {
    createEventMock.mockReset();
    hasAutoUpdateFailEventSinceMock.mockReset();
    hasAutoUpdateFailEventSinceMock.mockResolvedValue(false);
  });

  it("creates a warning event when no fail event exists since dateUpdated", async () => {
    await notifyAutoUpdate({
      context,
      experiment,
      success: false,
    });

    expect(hasAutoUpdateFailEventSinceMock).toHaveBeenCalledWith({
      organizationId: "org_1",
      experimentId: "exp_1",
      since: dateUpdated,
    });
    expect(createEventMock).toHaveBeenCalled();
  });

  it("does not create a warning event when a fail event already exists since dateUpdated", async () => {
    hasAutoUpdateFailEventSinceMock.mockResolvedValue(true);

    await notifyAutoUpdate({
      context,
      experiment,
      success: false,
    });

    expect(createEventMock).not.toHaveBeenCalled();
  });

  it("does not create a warning event on success", async () => {
    await notifyAutoUpdate({
      context,
      experiment,
      success: true,
    });

    expect(hasAutoUpdateFailEventSinceMock).not.toHaveBeenCalled();
    expect(createEventMock).not.toHaveBeenCalled();
  });
});
