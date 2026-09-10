import { describe, expect, it } from "vitest";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import {
  getExperimentHealthState,
  getHealthSortOrder,
  getTempRolloutHealthState,
  OLD_TEMP_ROLLOUT_DAYS,
} from "@/services/experiments";

const NOW = new Date("2026-09-10T12:00:00Z");

function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * 86400000).toISOString();
}

function stoppedExperiment(
  overrides: Partial<ExperimentInterfaceStringDates> = {},
): ExperimentInterfaceStringDates {
  return {
    status: "stopped",
    archived: false,
    excludeFromPayload: false,
    releasedVariationId: "v1",
    hasVisualChangesets: false,
    hasURLRedirects: false,
    linkedFeatures: ["feat_1"],
    phases: [{ dateStarted: daysAgo(40), dateEnded: daysAgo(5) }],
    ...overrides,
  } as ExperimentInterfaceStringDates;
}

describe("getTempRolloutHealthState", () => {
  it("is temp-rollout when stopped within the threshold", () => {
    expect(getTempRolloutHealthState(stoppedExperiment(), NOW)).toBe(
      "temp-rollout",
    );
  });

  it("stays temp-rollout on the threshold day itself", () => {
    const exp = stoppedExperiment({
      phases: [{ dateEnded: daysAgo(OLD_TEMP_ROLLOUT_DAYS) }],
    } as Partial<ExperimentInterfaceStringDates>);
    expect(getTempRolloutHealthState(exp, NOW)).toBe("temp-rollout");
  });

  it("is old-temp-rollout once past the threshold", () => {
    const exp = stoppedExperiment({
      phases: [{ dateEnded: daysAgo(OLD_TEMP_ROLLOUT_DAYS + 1) }],
    } as Partial<ExperimentInterfaceStringDates>);
    expect(getTempRolloutHealthState(exp, NOW)).toBe("old-temp-rollout");
  });

  it("uses the last phase's end date", () => {
    const exp = stoppedExperiment({
      phases: [{ dateEnded: daysAgo(400) }, { dateEnded: daysAgo(2) }],
    } as Partial<ExperimentInterfaceStringDates>);
    expect(getTempRolloutHealthState(exp, NOW)).toBe("temp-rollout");
  });

  it("falls back to temp-rollout when the end date is missing", () => {
    const exp = stoppedExperiment({
      phases: [{}],
    } as Partial<ExperimentInterfaceStringDates>);
    expect(getTempRolloutHealthState(exp, NOW)).toBe("temp-rollout");
  });

  it("is null for running experiments", () => {
    expect(
      getTempRolloutHealthState(stoppedExperiment({ status: "running" }), NOW),
    ).toBeNull();
  });

  it("is null when the rollout is excluded from the payload", () => {
    expect(
      getTempRolloutHealthState(
        stoppedExperiment({ excludeFromPayload: true }),
        NOW,
      ),
    ).toBeNull();
  });

  it("is null without a released variation", () => {
    expect(
      getTempRolloutHealthState(
        stoppedExperiment({ releasedVariationId: undefined }),
        NOW,
      ),
    ).toBeNull();
  });

  it("is null when archived", () => {
    expect(
      getTempRolloutHealthState(stoppedExperiment({ archived: true }), NOW),
    ).toBeNull();
  });

  it("is null without any linked changes", () => {
    expect(
      getTempRolloutHealthState(stoppedExperiment({ linkedFeatures: [] }), NOW),
    ).toBeNull();
  });
});

describe("getExperimentHealthState", () => {
  it("maps running health statuses to machine states", () => {
    const running = stoppedExperiment({ status: "running" });
    expect(getExperimentHealthState(running, "No data", NOW)).toBe("no-data");
    expect(getExperimentHealthState(running, "Unhealthy", NOW)).toBe(
      "unhealthy",
    );
  });

  it("ignores result statuses", () => {
    expect(getExperimentHealthState(stoppedExperiment(), "Won", NOW)).toBe(
      "temp-rollout",
    );
    expect(
      getExperimentHealthState(
        stoppedExperiment({ excludeFromPayload: true }),
        "Won",
        NOW,
      ),
    ).toBeNull();
  });
});

describe("getHealthSortOrder", () => {
  it("ranks urgency and gives healthy rows zero", () => {
    expect(getHealthSortOrder(null)).toBe(0);
    expect(getHealthSortOrder("temp-rollout")).toBeLessThan(
      getHealthSortOrder("old-temp-rollout"),
    );
    expect(getHealthSortOrder("old-temp-rollout")).toBeLessThan(
      getHealthSortOrder("no-data"),
    );
    expect(getHealthSortOrder("no-data")).toBeLessThan(
      getHealthSortOrder("unhealthy"),
    );
  });
});
