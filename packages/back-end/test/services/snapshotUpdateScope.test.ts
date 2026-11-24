import type { SnapshotUpdateScope } from "shared/validators";
import { findLatestSuccessfulSnapshotEndDate } from "back-end/src/models/ExperimentSnapshotModel";
import { createExperimentSnapshot } from "back-end/src/services/experiments";
import {
  createScopedExperimentSnapshot,
  resolveApiUpdateScope,
} from "back-end/src/services/experimentResults/plan/updateScope";
import {
  BadRequestError,
  NewMetricsUpdateUnavailableError,
  MetricsAlreadyUpToDateError,
  SnapshotInProgressError,
} from "back-end/src/util/errors";

jest.mock("back-end/src/models/ExperimentSnapshotModel", () => ({
  findLatestSuccessfulSnapshotEndDate: jest.fn(),
}));

jest.mock("back-end/src/services/experiments", () => ({
  createExperimentSnapshot: jest.fn(),
}));

const HOUR_MS = 3_600_000;
const now = new Date("2026-11-18T12:00:00Z");
const recentEnd = new Date(now.getTime() - HOUR_MS);
const newMetricsResult = { snapshot: { id: "snp_new" } };
const allMetricsResult = { snapshot: { id: "snp_all" } };
const notMissing = new MetricsAlreadyUpToDateError("snp_base");
const unavailable = new NewMetricsUpdateUnavailableError(
  "analysis_dates_changed",
  "Dates changed.",
);
const running = new SnapshotInProgressError("snp_running");
const otherError = new Error("Warehouse unreachable");

describe("updateScope", () => {
  it.each<{
    name: string;
    updateScope?: SnapshotUpdateScope;
    dimension?: string;
    triggeredBy?: "schedule";
    windowHours?: number;
    // The latest Overall Results' end date.
    resultsEndDate?: Date | null;
    newMetrics?: Error;
    // Undefined when the new-metrics update must not be tried.
    window?: { windowHours: number; now: Date } | null;
    expected: "new_metrics" | "all_metrics" | Error;
  }>([
    {
      name: "omitted: new metrics in the window",
      window: { windowHours: 4, now },
      expected: "new_metrics",
    },
    {
      name: "omitted: all, without planning, when the results ended before the window",
      resultsEndDate: new Date(now.getTime() - 5 * HOUR_MS),
      expected: "all_metrics",
    },
    {
      name: "omitted: all, without planning, when there are no results",
      resultsEndDate: null,
      expected: "all_metrics",
    },
    {
      name: '"auto" with a window of 0: all',
      updateScope: "auto",
      windowHours: 0,
      expected: "all_metrics",
    },
    {
      name: '"auto" with a dimension: all',
      dimension: "exp:browser",
      expected: "all_metrics",
    },
    {
      name: '"auto" for a scheduled update: all',
      triggeredBy: "schedule",
      expected: "all_metrics",
    },
    ...[notMissing, unavailable].map((newMetrics) => ({
      name: `"auto" falls back after ${newMetrics.name}`,
      newMetrics,
      window: { windowHours: 4, now },
      expected: "all_metrics" as const,
    })),
    {
      name: '"auto" fails on a running update instead of starting a second one',
      newMetrics: running,
      window: { windowHours: 4, now },
      expected: running,
    },
    {
      name: '"auto" fails on another error',
      newMetrics: otherError,
      window: { windowHours: 4, now },
      expected: otherError,
    },
    {
      name: '"new_metrics": new metrics, no window',
      updateScope: "new_metrics",
      resultsEndDate: new Date(now.getTime() - 5 * HOUR_MS),
      window: null,
      expected: "new_metrics",
    },
    ...[notMissing, unavailable, running].map((newMetrics) => ({
      name: `"new_metrics" fails on ${newMetrics.name}`,
      updateScope: "new_metrics" as const,
      newMetrics,
      window: null,
      expected: newMetrics,
    })),
    {
      name: '"new_metrics" with a dimension: 400',
      updateScope: "new_metrics",
      dimension: "exp:browser",
      expected: expect.any(BadRequestError),
    },
    {
      name: '"all_metrics": all',
      updateScope: "all_metrics",
      expected: "all_metrics",
    },
  ])(
    "$name",
    async ({
      newMetrics,
      window,
      expected,
      windowHours = 4,
      resultsEndDate = recentEnd,
      ...request
    }) => {
      jest.mocked(createExperimentSnapshot).mockReset();
      jest
        .mocked(findLatestSuccessfulSnapshotEndDate)
        .mockResolvedValue(resultsEndDate);
      if (newMetrics) {
        jest.mocked(createExperimentSnapshot).mockRejectedValue(newMetrics);
      } else {
        jest
          .mocked(createExperimentSnapshot)
          .mockResolvedValue(newMetricsResult as never);
      }
      const updateAllMetrics = jest
        .fn()
        .mockResolvedValue(allMetricsResult as never);

      const run = async () =>
        createScopedExperimentSnapshot({
          scope: resolveApiUpdateScope({
            updateScope: request.updateScope,
            dimension: request.dimension,
            triggeredBy: request.triggeredBy,
            windowHours,
            now,
          }),
          context: {} as never,
          experiment: { id: "exp_1" } as never,
          datasource: {} as never,
          phase: 0,
          updateAllMetrics,
        });

      if (typeof expected === "string") {
        const result = await run();
        expect(result.updateScope).toBe(expected);
        expect(result.snapshot).toBe(
          (expected === "new_metrics" ? newMetricsResult : allMetricsResult)
            .snapshot,
        );
      } else {
        await expect(run()).rejects.toEqual(expected);
        expect(updateAllMetrics).not.toHaveBeenCalled();
      }
      if (window === undefined) {
        expect(createExperimentSnapshot).not.toHaveBeenCalled();
      } else {
        expect(createExperimentSnapshot).toHaveBeenCalledWith(
          expect.objectContaining({
            dimension: undefined,
            useCache: true,
            updateScope: expect.objectContaining({
              kind: "new_metrics",
              window,
            }),
          }),
        );
      }
    },
  );
});
