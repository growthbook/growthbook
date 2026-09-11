import type { ExperimentInterface } from "shared/types/experiment";
import type { NotificationEvent } from "shared/types/events/notification-events";
import type { Context } from "back-end/src/models/BaseModel";
import { createEvent } from "back-end/src/models/EventModel";
import { setExperimentNotificationState } from "back-end/src/models/ExperimentModel";
import {
  notifyExperimentStarted,
  notifyExperimentStopped,
  notifyExperimentStatusTransition,
  notifyExperimentEndingSoon,
  notifyExperimentStale,
  notifyExperimentUpdateFailed,
  notifySrm,
  notifyMultipleExposures,
  notifyGuardrailFailed,
  notifyBanditWeightsChanged,
} from "back-end/src/services/experimentNotifications";
import { getExperimentMetricById } from "back-end/src/services/experiments";
import { findVisualChangesetsByExperiment } from "back-end/src/models/VisualChangesetModel";
import { getSlackMessageForNotificationEvent } from "back-end/src/events/handlers/slack/slack-event-handler-utils";

jest.mock("back-end/src/services/experiments", () => ({
  getExperimentMetricById: jest.fn(),
}));
jest.mock("back-end/src/models/VisualChangesetModel", () => ({
  findVisualChangesetsByExperiment: jest.fn(),
}));

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

  it.each([
    ["draft", "running", "status.started"],
    ["stopped", "running", "status.started"],
    ["running", "stopped", "status.stopped"],
    ["running", "running", null],
    ["stopped", "stopped", null],
    ["running", "draft", null],
    ["stopped", "draft", null],
  ] as const)(
    "emits one lifecycle alert for %s → %s",
    async (before, after, event) => {
      await notifyExperimentStatusTransition({
        context,
        previous: { ...experiment, status: before },
        experiment: { ...experiment, status: after },
      });
      expect(createEvent).toHaveBeenCalledTimes(event ? 1 : 0);
      if (event)
        expect(createEvent).toHaveBeenCalledWith(
          expect.objectContaining({ event }),
        );
    },
  );

  it("captures linked implementation counts at start", async () => {
    jest
      .mocked(findVisualChangesetsByExperiment)
      .mockResolvedValue([{ id: "visual1" }] as Awaited<
        ReturnType<typeof findVisualChangesetsByExperiment>
      >);
    const findByExperiment = jest
      .fn()
      .mockResolvedValue([{ id: "url1" }, { id: "url2" }]);
    await notifyExperimentStarted({
      context: {
        ...context,
        models: { urlRedirects: { findByExperiment } },
      } as unknown as Context,
      experiment: {
        ...experiment,
        linkedFeatures: ["a", "b", "a"],
        hasVisualChangesets: true,
        hasURLRedirects: true,
      },
    });
    expect(createEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "status.started",
        data: {
          object: expect.objectContaining({
            linkedFeatureCount: 2,
            visualChangesetCount: 1,
            urlRedirectCount: 2,
          }),
        },
      }),
    );
    expect(findByExperiment).toHaveBeenCalledWith(experiment.id);
    expect(findVisualChangesetsByExperiment).toHaveBeenCalledWith(
      experiment.id,
      context.org.id,
    );
  });

  it("preserves the saved stop outcome, rollout, and reason", async () => {
    await notifyExperimentStatusTransition({
      context,
      previous: experiment,
      experiment: {
        ...experiment,
        status: "stopped",
        results: "inconclusive",
        releasedVariationId: "control",
        excludeFromPayload: false,
        variations: [
          {
            id: "control",
            name: "Original",
            key: "0",
            description: "",
            screenshots: [],
          },
        ],
        phases: [
          { ...experiment.phases[0], reason: "Investigate instrumentation" },
        ],
      },
    });
    expect(createEvent).toHaveBeenCalledTimes(1);
    expect(createEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "status.stopped",
        data: {
          object: expect.objectContaining({
            results: "inconclusive",
            enableTemporaryRollout: true,
            releasedVariationName: "Original",
            reason: "Investigate instrumentation",
          }),
        },
      }),
    );
  });

  it("does not invent a result or rollout when stopping without a decision", async () => {
    await notifyExperimentStatusTransition({
      context,
      previous: experiment,
      experiment: { ...experiment, status: "stopped" },
    });
    expect(createEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "status.stopped",
        data: {
          object: expect.objectContaining({
            results: undefined,
            enableTemporaryRollout: false,
          }),
        },
      }),
    );
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
        event: "status.stopped",
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
        event: "status.stale",
        data: { object: expect.objectContaining({ daysRunning: 90 }) },
      }),
    );
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
        event: "status.endingSoon",
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

  it.each(["query", "analysis", "no-queries"] as const)(
    "emits the %s cause once per failure period",
    async (cause) => {
      await notifyExperimentUpdateFailed({ context, experiment, cause });
      expect(createEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          event: "health.updateFailure",
          data: {
            object: {
              type: "update-failed",
              experimentId: experiment.id,
              experimentName: experiment.name,
              cause,
            },
          },
        }),
      );
      await notifyExperimentUpdateFailed({
        context,
        experiment: { ...experiment, pastNotifications: ["query-failed"] },
        cause,
      });
      expect(createEvent).toHaveBeenCalledTimes(1);
    },
  );

  it("does not notify or reset an existing failure when cancelled", async () => {
    await notifyExperimentUpdateFailed({
      context,
      experiment: { ...experiment, pastNotifications: ["query-failed"] },
      cause: "cancelled",
    });
    expect(createEvent).not.toHaveBeenCalled();
    expect(setExperimentNotificationState).not.toHaveBeenCalled();
  });

  it("clears only the failure marker on recovery", async () => {
    await notifyExperimentUpdateFailed({
      context,
      experiment,
      cause: "query",
    });
    expect(JSON.stringify(jest.mocked(createEvent).mock.calls)).not.toContain(
      "secret-database-password",
    );
    jest.mocked(createEvent).mockClear();
    const failed = {
      ...experiment,
      pastNotifications: ["query-failed", "srm"],
    } as ExperimentInterface;
    await notifyExperimentUpdateFailed({
      context,
      experiment: failed,
      cause: null,
    });
    expect(createEvent).not.toHaveBeenCalled();
    expect(setExperimentNotificationState).toHaveBeenLastCalledWith({
      context,
      experiment: failed,
      type: "query-failed",
      triggered: false,
    });
  });

  it("emits distinct health alerts once and resets them on recovery", async () => {
    const currentStatus = {
      status: "unhealthy" as const,
      unhealthyData: {
        srm: true,
        multipleExposures: { rawDecimal: 0.05, multipleExposedUsers: 50 },
      },
    };
    const healthSettings = {
      srmThreshold: 0.001,
      multipleExposureMinPercent: 0.01,
    };
    await notifySrm({ context, experiment, currentStatus, healthSettings });
    await notifyMultipleExposures({ context, experiment, currentStatus });
    expect(
      jest.mocked(createEvent).mock.calls.map(([args]) => args.event),
    ).toEqual(["health.srm", "health.multipleExposures"]);
    const notified = {
      ...experiment,
      pastNotifications: ["srm", "multiple-exposures"],
    } as ExperimentInterface;
    await notifySrm({
      context,
      experiment: notified,
      currentStatus,
      healthSettings,
    });
    await notifyMultipleExposures({
      context,
      experiment: notified,
      currentStatus,
    });
    expect(createEvent).toHaveBeenCalledTimes(2);
    const recovered = { status: "before-min-duration" as const };
    await notifySrm({
      context,
      experiment: notified,
      currentStatus: recovered,
      healthSettings,
    });
    await notifyMultipleExposures({
      context,
      experiment: notified,
      currentStatus: recovered,
    });
    expect(createEvent).toHaveBeenCalledTimes(2);
    expect(
      jest
        .mocked(setExperimentNotificationState)
        .mock.calls.slice(-2)
        .map(([args]) => ({ type: args.type, triggered: args.triggered })),
    ).toEqual([
      { type: "srm", triggered: false },
      { type: "multiple-exposures", triggered: false },
    ]);
  });

  it("sends all failed guardrails in one event that Slack can render", async () => {
    jest.mocked(getExperimentMetricById).mockResolvedValue(null);
    const variations = [
      { id: "a", name: "A", key: "0", screenshots: [], description: "" },
      { id: "b", name: "B", key: "1", screenshots: [], description: "" },
    ];
    await notifyGuardrailFailed({
      context,
      experiment: {
        ...experiment,
        variations,
        phases: [
          {
            ...experiment.phases[0],
            variations: variations.map(({ id }) => ({
              id,
              status: "active" as const,
            })),
          },
        ],
        analysisSummary: {
          snapshotId: "snap1",
          resultsStatus: {
            settings: { sequentialTesting: false },
            variations: [
              {
                variationId: "a",
                guardrailMetrics: {
                  revenue: { status: "lost" },
                  errors: { status: "safe" },
                },
              },
              {
                variationId: "b",
                guardrailMetrics: { errors: { status: "lost" } },
              },
            ],
          },
        },
      },
    });
    expect(createEvent).toHaveBeenCalledTimes(1);
    const args = jest.mocked(createEvent).mock.calls[0][0];
    expect(args.event).toBe("metric.guardrailFailure");
    expect(args.data).toMatchObject({
      object: {
        failedMetrics: [
          { id: "revenue", name: "revenue", variationName: "A" },
          { id: "errors", name: "errors", variationName: "B" },
        ],
      },
    });
    const event = {
      event: `experiment.${args.event}`,
      data: args.data,
    } as NotificationEvent;
    expect(
      (await getSlackMessageForNotificationEvent(event, "event_test"))?.text,
    ).toContain("Failing guardrails: revenue (A), errors (B).");
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
});
