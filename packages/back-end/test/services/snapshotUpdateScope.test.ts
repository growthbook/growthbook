import type { SnapshotUpdateScope } from "shared/validators";
import {
  getUpdateScopeStep,
  type UpdateScopeStep,
} from "back-end/src/services/snapshotUpdateScope";
import {
  MetricRefreshOutsideWindowError,
  MetricRefreshUnavailableError,
  MetricsAlreadyUpToDateError,
  SnapshotInProgressError,
} from "back-end/src/util/errors";

const now = new Date("2026-11-18T12:00:00Z");

describe("getUpdateScopeStep", () => {
  describe("before anything runs", () => {
    it.each<{
      name: string;
      updateScope?: SnapshotUpdateScope;
      dimension?: string;
      triggeredBy?: "manual" | "schedule";
      windowHours?: number;
      expected: UpdateScopeStep["action"];
    }>([
      {
        name: "an omitted scope",
        expected: "update_new_metrics",
      },
      {
        name: '"auto" with a window of 0',
        updateScope: "auto",
        windowHours: 0,
        expected: "update_all_metrics",
      },
      {
        name: '"auto" with a dimension',
        dimension: "exp:browser",
        expected: "update_all_metrics",
      },
      {
        name: '"auto" for a scheduled update',
        triggeredBy: "schedule",
        expected: "update_all_metrics",
      },
      {
        name: '"new_metrics"',
        updateScope: "new_metrics",
        expected: "update_new_metrics",
      },
      {
        name: '"all_metrics"',
        updateScope: "all_metrics",
        expected: "update_all_metrics",
      },
    ])("$name: $expected", ({ expected, windowHours = 4, ...request }) => {
      const step = getUpdateScopeStep({
        updateScope: request.updateScope,
        dimension: request.dimension,
        triggeredBy: request.triggeredBy,
        windowHours,
        now,
        newMetricsRefusal: null,
      });
      expect(step.action).toBe(expected);
    });

    it('applies the window to "auto" only', () => {
      const step = (updateScope: SnapshotUpdateScope) =>
        getUpdateScopeStep({
          updateScope,
          dimension: undefined,
          triggeredBy: undefined,
          windowHours: 4,
          now,
          newMetricsRefusal: null,
        });

      expect(step("auto")).toEqual({
        action: "update_new_metrics",
        window: { windowHours: 4, now },
      });
      expect(step("new_metrics")).toEqual({
        action: "update_new_metrics",
        window: null,
      });
    });
  });

  describe("after the new-metrics update was refused", () => {
    const refusals = [
      {
        name: "outside the window",
        error: new MetricRefreshOutsideWindowError(),
      },
      {
        name: "nothing missing",
        error: new MetricsAlreadyUpToDateError("snp_base"),
      },
      {
        name: "changed analysis dates",
        error: new MetricRefreshUnavailableError(
          "analysis_dates_changed",
          "Dates changed.",
        ),
      },
      {
        name: "an unsupported metric",
        error: new MetricRefreshUnavailableError(
          "metric_not_supported",
          "Not supported.",
        ),
      },
      {
        name: "another update running",
        error: new SnapshotInProgressError("snp_running"),
      },
    ];
    const after = (updateScope: SnapshotUpdateScope, error: unknown) =>
      getUpdateScopeStep({
        updateScope,
        dimension: undefined,
        triggeredBy: undefined,
        windowHours: 4,
        now,
        newMetricsRefusal: { error },
      });

    it.each(refusals)(
      '"auto" runs a normal update and "new_metrics" returns the refusal after $name',
      ({ error }) => {
        expect(after("auto", error)).toEqual({ action: "update_all_metrics" });
        expect(after("new_metrics", error)).toEqual({ action: "fail", error });
      },
    );
  });
});
