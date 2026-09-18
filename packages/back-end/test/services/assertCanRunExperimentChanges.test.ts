import { ExperimentInterface } from "shared/validators";
import { ReqContext } from "back-end/types/organization";
import { assertCanRunExperimentChanges } from "back-end/src/services/experiments";

// Import cycles: a lazy Proxy defers requireActual to first property access.
const getFeaturesByIdsMock = jest.fn();
const getFeatureProjectsByIdsMock = jest.fn();

jest.mock("back-end/src/models/FeatureModel", () => {
  const overrides: Record<string, unknown> = {
    getFeaturesByIds: (...args: unknown[]) => getFeaturesByIdsMock(...args),
    getFeatureProjectsByIds: (...args: unknown[]) =>
      getFeatureProjectsByIdsMock(...args),
  };
  return new Proxy(
    {},
    {
      get: (_t, prop: string) =>
        prop in overrides
          ? overrides[prop]
          : jest.requireActual("back-end/src/models/FeatureModel")[prop],
    },
  );
});

const experiment = (over: Partial<ExperimentInterface> = {}) =>
  ({
    id: "exp_1",
    project: "proj_1",
    linkedFeatures: [],
    hasVisualChangesets: false,
    hasURLRedirects: false,
    ...over,
  }) as ExperimentInterface;

const canRunExperiment = jest.fn();
const throwPermissionError = jest.fn(() => {
  throw new Error("permission denied");
});

const context = {
  org: { id: "org_1", settings: { environments: [{ id: "production" }] } },
  permissions: { canRunExperiment, throwPermissionError },
} as unknown as ReqContext;

describe("assertCanRunExperimentChanges", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getFeaturesByIdsMock.mockResolvedValue([]);
    getFeatureProjectsByIdsMock.mockResolvedValue(new Map());
    canRunExperiment.mockReturnValue(false);
  });

  it("skips the check for changes that never reach a payload", async () => {
    await assertCanRunExperimentChanges(
      context,
      experiment({ hasVisualChangesets: true }),
      { description: "new text" },
    );
    expect(canRunExperiment).not.toHaveBeenCalled();
  });

  it("checks bucketing fields, which do reach the payload", async () => {
    await expect(
      assertCanRunExperimentChanges(
        context,
        experiment({ hasVisualChangesets: true }),
        { bucketVersion: 2 },
      ),
    ).rejects.toThrow("permission denied");
  });

  it("asks for every environment when a linked feature cannot be read", async () => {
    getFeatureProjectsByIdsMock.mockResolvedValue(
      new Map([["feat_1", "proj_2"]]),
    );

    await expect(
      assertCanRunExperimentChanges(
        context,
        experiment({ linkedFeatures: ["feat_1"] }),
        { status: "stopped" },
      ),
    ).rejects.toThrow("permission denied");
    expect(canRunExperiment).toHaveBeenCalledWith({ project: "proj_1" }, [
      "__ALL__",
    ]);
  });

  it("ignores ids left behind by a deleted feature", async () => {
    await assertCanRunExperimentChanges(
      context,
      experiment({ linkedFeatures: ["feat_gone"] }),
      { status: "stopped" },
    );
    expect(canRunExperiment).not.toHaveBeenCalled();
  });

  describe("statusUpdateSchedule", () => {
    const future = new Date(Date.now() + 60 * 60 * 1000);
    const served = experiment({ hasVisualChangesets: true });

    it.each([
      { plan: { mode: "stop" as const } },
      { plan: { mode: "force-ship" as const, fallbackVariationId: "v1" } },
      { plan: { mode: "auto-ship" as const, fallback: "notify" as const } },
    ])("checks a scheduled end that will $plan.mode", async ({ plan }) => {
      await expect(
        assertCanRunExperimentChanges(context, served, {
          statusUpdateSchedule: { stopAt: future, scheduledStopPlan: plan },
        }),
      ).rejects.toThrow("permission denied");
    });

    it("checks a relative end (stopAfter) that will stop", async () => {
      await expect(
        assertCanRunExperimentChanges(context, served, {
          statusUpdateSchedule: {
            stopAfter: { value: 3, unit: "days" },
            scheduledStopPlan: { mode: "stop" },
          },
        }),
      ).rejects.toThrow("permission denied");
    });

    it("skips a notify-only end, an end with no plan, and a start-only schedule", async () => {
      await assertCanRunExperimentChanges(context, served, {
        statusUpdateSchedule: {
          stopAt: future,
          scheduledStopPlan: { mode: "notify" },
        },
      });
      await assertCanRunExperimentChanges(context, served, {
        statusUpdateSchedule: { stopAt: future },
      });
      await assertCanRunExperimentChanges(context, served, {
        statusUpdateSchedule: { startAt: future },
      });
      expect(canRunExperiment).not.toHaveBeenCalled();
    });

    it("checks clearing or downgrading a stop that is still pending", async () => {
      const withPendingStop = experiment({
        hasVisualChangesets: true,
        statusUpdateSchedule: {
          stopAt: future,
          scheduledStopPlan: { mode: "stop" },
        },
        nextScheduledStatusUpdate: { type: "stop", date: future },
      });
      await expect(
        assertCanRunExperimentChanges(context, withPendingStop, {
          statusUpdateSchedule: null,
        }),
      ).rejects.toThrow("permission denied");
      await expect(
        assertCanRunExperimentChanges(context, withPendingStop, {
          statusUpdateSchedule: {
            stopAt: future,
            scheduledStopPlan: { mode: "notify" },
          },
        }),
      ).rejects.toThrow("permission denied");
    });

    it("skips clearing a stop plan that is no longer pending, or a notify-only end", async () => {
      const past = new Date(Date.now() - 60 * 60 * 1000);
      const withStaleStop = experiment({
        hasVisualChangesets: true,
        statusUpdateSchedule: {
          stopAt: past,
          scheduledStopPlan: { mode: "stop" },
        },
        nextScheduledStatusUpdate: null,
      });
      await assertCanRunExperimentChanges(context, withStaleStop, {
        statusUpdateSchedule: null,
      });
      // The pending pointer, not the date, decides: a stop the job gave up on
      // (future stopAt, pointer cleared) can also be cleared.
      const withAbandonedStop = experiment({
        hasVisualChangesets: true,
        statusUpdateSchedule: {
          stopAt: future,
          scheduledStopPlan: { mode: "stop" },
        },
        nextScheduledStatusUpdate: null,
      });
      await assertCanRunExperimentChanges(context, withAbandonedStop, {
        statusUpdateSchedule: null,
      });
      const withNotify = experiment({
        hasVisualChangesets: true,
        statusUpdateSchedule: {
          stopAt: future,
          scheduledStopPlan: { mode: "notify" },
        },
        nextScheduledStatusUpdate: { type: "stop", date: future },
      });
      await assertCanRunExperimentChanges(context, withNotify, {
        statusUpdateSchedule: null,
      });
      expect(canRunExperiment).not.toHaveBeenCalled();
    });

    it("checks a draft that already reaches an environment, like other payload fields", async () => {
      // normalize stages no stop for a draft, so only the incoming side applies.
      const linkedDraft = experiment({
        status: "draft",
        hasVisualChangesets: true,
        nextScheduledStatusUpdate: null,
      });
      await expect(
        assertCanRunExperimentChanges(context, linkedDraft, {
          statusUpdateSchedule: {
            stopAfter: { value: 7, unit: "days" },
            scheduledStopPlan: { mode: "stop" },
          },
        }),
      ).rejects.toThrow("permission denied");
    });

    it("passes with run-experiments permission", async () => {
      canRunExperiment.mockReturnValue(true);
      await assertCanRunExperimentChanges(context, served, {
        statusUpdateSchedule: {
          stopAt: future,
          scheduledStopPlan: { mode: "stop" },
        },
      });
      expect(canRunExperiment).toHaveBeenCalledWith({ project: "proj_1" }, [
        "__ALL__",
      ]);
    });
  });
});
