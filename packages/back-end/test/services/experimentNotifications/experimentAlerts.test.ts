import type { ExperimentInterface } from "shared/types/experiment";
import type { Context } from "back-end/src/models/BaseModel";
import { createEvent } from "back-end/src/models/EventModel";
import { setExperimentNotificationState } from "back-end/src/models/ExperimentModel";
import {
  notifyBanditWeightsChanged,
  notifyExperimentEndingSoon,
  notifyExperimentQueryFailed,
  notifyExperimentStale,
  notifyExperimentStopped,
} from "back-end/src/services/experimentNotifications";

jest.mock("back-end/src/models/EventModel", () => ({ createEvent: jest.fn() }));
jest.mock("back-end/src/models/ExperimentModel", () => ({
  setExperimentNotificationState: jest.fn(),
}));

const context = { org: { id: "org_test" } } as Context;
const now = new Date("2026-09-10T12:00:00Z");
const day = 86400000;
const experiment = {
  id: "exp_test",
  name: "Test experiment",
  status: "running",
  type: "standard",
  phases: [{ dateStarted: new Date(now.getTime() - 90 * day) }],
  variations: [],
  tags: [],
  pastNotifications: [],
} as unknown as ExperimentInterface;

describe("experiment alert producers", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(now);
  });
  afterEach(() => jest.useRealTimers());

  it("requires 90 complete days for a stale alert", async () => {
    await notifyExperimentStale({
      context,
      experiment: {
        ...experiment,
        phases: [
          {
            ...experiment.phases[0],
            dateStarted: new Date(now.getTime() - 90 * day + 1),
          },
        ],
      },
    });
    expect(createEvent).not.toHaveBeenCalled();
    await notifyExperimentStale({ context, experiment });
    expect(createEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "stale",
        data: { object: expect.objectContaining({ daysRunning: 90 }) },
      }),
    );
  });

  it("does not announce an end date outside the window or in the past", async () => {
    for (const stopAt of [
      new Date(now.getTime() + 3 * day + 1),
      new Date(now.getTime() - 1),
    ]) {
      await notifyExperimentEndingSoon({
        context,
        experiment: {
          ...experiment,
          statusUpdateSchedule: { stopAt },
        } as ExperimentInterface,
      });
    }
    expect(createEvent).not.toHaveBeenCalled();
  });

  it("updates independent markers when ending and stale alerts fire together", async () => {
    const scheduled = {
      ...experiment,
      statusUpdateSchedule: { stopAt: new Date(now.getTime() + 2 * day + 1) },
    } as ExperimentInterface;
    await notifyExperimentEndingSoon({ context, experiment: scheduled });
    await notifyExperimentStale({ context, experiment: scheduled });
    expect(createEvent).toHaveBeenCalledTimes(2);
    expect(createEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "endingSoon",
        data: { object: expect.objectContaining({ daysRemaining: 3 }) },
      }),
    );
    expect(
      jest.mocked(setExperimentNotificationState).mock.calls.map(([args]) => ({
        type: args.type,
        triggered: args.triggered,
      })),
    ).toEqual([
      { type: "ending-soon", triggered: true },
      { type: "stale", triggered: true },
    ]);
  });

  it("redacts query errors and clears only the query marker on recovery", async () => {
    await notifyExperimentQueryFailed({
      context,
      experiment,
      errorMessage: "secret-database-password",
    });
    expect(JSON.stringify(jest.mocked(createEvent).mock.calls)).not.toContain(
      "secret-database-password",
    );
    jest.mocked(createEvent).mockClear();
    const failed = {
      ...experiment,
      pastNotifications: ["query-failed", "srm"],
    } as ExperimentInterface;
    await notifyExperimentQueryFailed({
      context,
      experiment: failed,
      triggered: false,
    });
    expect(createEvent).not.toHaveBeenCalled();
    expect(setExperimentNotificationState).toHaveBeenLastCalledWith({
      context,
      experiment: failed,
      type: "query-failed",
      triggered: false,
    });
  });

  it("ignores insignificant or invalid bandit allocations", async () => {
    for (const updatedWeights of [[0.51, 0.49], [NaN, 0.5], [0.6]]) {
      await notifyBanditWeightsChanged({
        context,
        experiment,
        currentWeights: [0.5, 0.5],
        updatedWeights,
      });
    }
    expect(createEvent).not.toHaveBeenCalled();
    await notifyBanditWeightsChanged({
      context,
      experiment,
      currentWeights: [0.5, 0.5],
      updatedWeights: [0.7, 0.3],
    });
    expect(createEvent).toHaveBeenCalledTimes(1);
  });

  it("retains an inconclusive stop without inventing a shipped winner", async () => {
    await notifyExperimentStopped({
      context,
      experiment,
      type: "stopped",
      results: "inconclusive",
      enableTemporaryRollout: false,
    });
    expect(createEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "stopped",
        data: {
          object: expect.objectContaining({
            results: "inconclusive",
            enableTemporaryRollout: false,
            releasedVariationName: undefined,
          }),
        },
      }),
    );
  });
});
