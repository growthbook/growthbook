import { describe, expect, it } from "vitest";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { OLD_TEMP_ROLLOUT_DAYS } from "shared/util";
import {
  getExperimentHealthState,
  getHealthSearchTokens,
  getHealthSortOrder,
  getTempRolloutHealthState,
  getTempRolloutTooltip,
} from "@/services/experiments";

const NOW = new Date("2026-09-10T12:00:00Z");

function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * 86400000).toISOString();
}

function stopped(
  phases: { dateEnded?: string }[] = [{ dateEnded: daysAgo(5) }],
): Pick<ExperimentInterfaceStringDates, "status" | "phases"> {
  return {
    status: "stopped",
    phases,
  } as Pick<ExperimentInterfaceStringDates, "status" | "phases">;
}

describe("getTempRolloutHealthState", () => {
  it("is temp-rollout when served and stopped within the threshold", () => {
    expect(getTempRolloutHealthState(stopped(), true, NOW)).toBe(
      "temp-rollout",
    );
  });

  it("stays temp-rollout on the threshold day itself", () => {
    expect(
      getTempRolloutHealthState(
        stopped([{ dateEnded: daysAgo(OLD_TEMP_ROLLOUT_DAYS) }]),
        true,
        NOW,
      ),
    ).toBe("temp-rollout");
  });

  it("is old-temp-rollout once past the threshold", () => {
    expect(
      getTempRolloutHealthState(
        stopped([{ dateEnded: daysAgo(OLD_TEMP_ROLLOUT_DAYS + 1) }]),
        true,
        NOW,
      ),
    ).toBe("old-temp-rollout");
  });

  it("uses the last phase's end date", () => {
    expect(
      getTempRolloutHealthState(
        stopped([{ dateEnded: daysAgo(400) }, { dateEnded: daysAgo(2) }]),
        true,
        NOW,
      ),
    ).toBe("temp-rollout");
  });

  it("falls back to temp-rollout when the end date is missing", () => {
    expect(getTempRolloutHealthState(stopped([{}]), true, NOW)).toBe(
      "temp-rollout",
    );
  });

  it("is null when the server says the rollout is not being served", () => {
    expect(getTempRolloutHealthState(stopped(), false, NOW)).toBeNull();
  });

  it("is null for running experiments even if flagged", () => {
    expect(
      getTempRolloutHealthState({ ...stopped(), status: "running" }, true, NOW),
    ).toBeNull();
  });
});

describe("getExperimentHealthState", () => {
  it("maps running health statuses to machine states", () => {
    const running = { ...stopped(), status: "running" as const };
    expect(getExperimentHealthState(running, "No data", false, NOW)).toBe(
      "no-data",
    );
    expect(getExperimentHealthState(running, "Unhealthy", false, NOW)).toBe(
      "unhealthy",
    );
  });

  it("ignores result statuses and falls through to temp rollout", () => {
    expect(getExperimentHealthState(stopped(), "Won", true, NOW)).toBe(
      "temp-rollout",
    );
    expect(getExperimentHealthState(stopped(), "Won", false, NOW)).toBeNull();
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

describe("getHealthSearchTokens", () => {
  it("lets health:temp-rollout match both tiers", () => {
    expect(getHealthSearchTokens("temp-rollout")).toEqual(["temp-rollout"]);
    expect(getHealthSearchTokens("old-temp-rollout")).toEqual([
      "old-temp-rollout",
      "temp-rollout",
    ]);
    expect(getHealthSearchTokens("unhealthy")).toEqual(["unhealthy"]);
    expect(getHealthSearchTokens(null)).toEqual([]);
  });
});

describe("getTempRolloutTooltip", () => {
  it("includes how long ago the experiment stopped", () => {
    const fiveDaysAgo = new Date(Date.now() - 5 * 86400000).toISOString();
    expect(
      getTempRolloutTooltip(
        stopped([{ dateEnded: fiveDaysAgo }]) as ExperimentInterfaceStringDates,
      ),
    ).toMatch(/^Stopped 5 days ago with its temporary rollout/);
  });

  it("omits the duration when the end date is missing", () => {
    expect(
      getTempRolloutTooltip(stopped([{}]) as ExperimentInterfaceStringDates),
    ).toMatch(/^Stopped with its temporary rollout/);
  });
});
