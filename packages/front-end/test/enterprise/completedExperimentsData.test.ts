import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import {
  bucketVelocity,
  classifyVelocityResult,
  computeWinRateByProject,
  computeWinRateSummary,
  filterCompletedExperiments,
  floorToGranularity,
  getExperimentResultDate,
  getPreviousWindow,
} from "@/enterprise/components/Dashboards/DashboardEditor/DashboardBlock/completedExperimentsData";

// Minimal experiment factory — only the fields the helpers read.
function exp({
  results,
  project,
  endedISO,
  status = "stopped",
  type = "standard",
  mainEndedISO,
}: {
  results?: "won" | "lost" | "inconclusive" | "dnf";
  project?: string;
  endedISO?: string;
  status?: string;
  type?: string;
  mainEndedISO?: string;
}): ExperimentInterfaceStringDates {
  const phases: { name: string; dateEnded?: string }[] = [];
  if (endedISO) phases.push({ name: "First", dateEnded: endedISO });
  if (mainEndedISO) phases.push({ name: "Main", dateEnded: mainEndedISO });
  return {
    results,
    project: project ?? "",
    status,
    type,
    phases,
  } as unknown as ExperimentInterfaceStringDates;
}

describe("getPreviousWindow", () => {
  it("returns the equal-length window immediately before the current one", () => {
    const startDate = new Date("2026-04-01T00:00:00Z");
    const endDate = new Date("2026-05-01T00:00:00Z");
    const prev = getPreviousWindow({ startDate, endDate });
    // The previous window ends 1ms BEFORE the current start (exclusive
    // boundary), so an experiment ending exactly at the boundary instant is
    // only ever counted in the current window.
    expect(prev.endDate.getTime()).toBe(startDate.getTime() - 1);
    expect(prev.startDate.getTime()).toBe(
      startDate.getTime() - (endDate.getTime() - startDate.getTime()),
    );
    expect(prev.startDate).toEqual(new Date("2026-03-02T00:00:00Z"));
  });

  it("does not double-count an experiment ending exactly at the window boundary", () => {
    const startDate = new Date("2026-04-01T00:00:00Z");
    const endDate = new Date("2026-05-01T00:00:00Z");
    const prev = getPreviousWindow({ startDate, endDate });
    const boundaryExp = exp({
      results: "won",
      endedISO: "2026-04-01T00:00:00Z",
    });
    const inCurrent = filterCompletedExperiments([boundaryExp], {
      startDate,
      endDate,
      projects: [],
    });
    const inPrevious = filterCompletedExperiments([boundaryExp], {
      ...prev,
      projects: [],
    });
    expect(inCurrent).toHaveLength(1);
    expect(inPrevious).toHaveLength(0);
  });
});

describe("filterCompletedExperiments", () => {
  const startDate = new Date("2026-01-01T00:00:00Z");
  const endDate = new Date("2026-03-31T23:59:59.999Z");
  const window = { startDate, endDate, projects: [] };

  it("keeps stopped, non-bandit experiments whose result date is in-window", () => {
    const inWindow = exp({ results: "won", endedISO: "2026-02-01T00:00:00Z" });
    const outOfWindow = exp({
      results: "won",
      endedISO: "2025-12-31T00:00:00Z",
    });
    const running = exp({
      results: "won",
      endedISO: "2026-02-01T00:00:00Z",
      status: "running",
    });
    const bandit = exp({
      results: "won",
      endedISO: "2026-02-01T00:00:00Z",
      type: "multi-armed-bandit",
    });
    expect(
      filterCompletedExperiments(
        [inWindow, outOfWindow, running, bandit],
        window,
      ),
    ).toEqual([inWindow]);
  });

  it("uses the Main-phase-preferred result date, same as bucketVelocity", () => {
    // Non-Main phase ended in-window, but the Main phase (the result date)
    // ended outside it: the experiment must NOT count, so the Win Percentage
    // and Team Velocity blocks agree on the experiment set.
    const mainOutside = exp({
      results: "won",
      endedISO: "2026-02-01T00:00:00Z",
      mainEndedISO: "2026-05-01T00:00:00Z",
    });
    expect(filterCompletedExperiments([mainOutside], window)).toEqual([]);

    // And the converse: Main in-window counts even if another phase is not.
    const mainInside = exp({
      results: "won",
      endedISO: "2025-06-01T00:00:00Z",
      mainEndedISO: "2026-02-01T00:00:00Z",
    });
    expect(filterCompletedExperiments([mainInside], window)).toHaveLength(1);
  });

  it("scopes to selected projects", () => {
    const p1 = exp({
      results: "won",
      project: "p1",
      endedISO: "2026-02-01T00:00:00Z",
    });
    const noProject = exp({
      results: "won",
      endedISO: "2026-02-01T00:00:00Z",
    });
    expect(
      filterCompletedExperiments([p1, noProject], {
        ...window,
        projects: ["p1"],
      }),
    ).toEqual([p1]);
  });
});

describe("classifyVelocityResult", () => {
  it("maps explicit results and defaults everything else to inconclusive", () => {
    expect(classifyVelocityResult(exp({ results: "won" }))).toBe("won");
    expect(classifyVelocityResult(exp({ results: "lost" }))).toBe("lost");
    expect(classifyVelocityResult(exp({ results: "dnf" }))).toBe("dnf");
    expect(classifyVelocityResult(exp({ results: "inconclusive" }))).toBe(
      "inconclusive",
    );
    expect(classifyVelocityResult(exp({}))).toBe("inconclusive");
  });
});

describe("getExperimentResultDate", () => {
  it("prefers the most recent Main phase over other phases", () => {
    const e = exp({
      endedISO: "2026-01-10T00:00:00Z",
      mainEndedISO: "2026-02-20T00:00:00Z",
    });
    expect(getExperimentResultDate(e)).toEqual(
      new Date("2026-02-20T00:00:00Z"),
    );
  });
  it("falls back to the latest phase when there is no Main phase", () => {
    const e = exp({ endedISO: "2026-01-10T00:00:00Z" });
    expect(getExperimentResultDate(e)).toEqual(
      new Date("2026-01-10T00:00:00Z"),
    );
  });
  it("returns null when no phase has ended", () => {
    expect(getExperimentResultDate(exp({}))).toBeNull();
  });
});

describe("floorToGranularity", () => {
  const d = new Date(2026, 4, 20, 15); // May 20 2026, 15:00 local
  it("floors to day/month/year", () => {
    expect(floorToGranularity(d, "day")).toEqual(new Date(2026, 4, 20));
    expect(floorToGranularity(d, "month")).toEqual(new Date(2026, 4, 1));
    expect(floorToGranularity(d, "year")).toEqual(new Date(2026, 0, 1));
  });
  it("floors weeks back to Sunday", () => {
    // May 20 2026 is a Wednesday -> week start Sunday May 17.
    expect(floorToGranularity(d, "week")).toEqual(new Date(2026, 4, 17));
  });
});

describe("bucketVelocity", () => {
  const startDate = new Date(2026, 0, 1);
  const endDate = new Date(2026, 2, 31, 23, 59);

  it("emits one bucket per month including empties, and tallies by result", () => {
    const experiments = [
      exp({ results: "won", endedISO: new Date(2026, 0, 10).toISOString() }),
      exp({ results: "lost", endedISO: new Date(2026, 0, 20).toISOString() }),
      exp({ results: "dnf", endedISO: new Date(2026, 2, 5).toISOString() }),
      exp({ endedISO: new Date(2026, 2, 6).toISOString() }), // inconclusive
    ];
    const buckets = bucketVelocity(
      experiments,
      { startDate, endDate },
      "month",
    );
    expect(buckets).toHaveLength(3); // Jan, Feb, Mar
    expect(buckets[0]).toMatchObject({ won: 1, lost: 1, total: 2 });
    expect(buckets[1]).toMatchObject({ total: 0 }); // Feb empty
    expect(buckets[2]).toMatchObject({ dnf: 1, inconclusive: 1, total: 2 });
  });

  it("ignores experiments whose result date is outside the window", () => {
    const experiments = [
      exp({ results: "won", endedISO: new Date(2025, 11, 31).toISOString() }),
      exp({ results: "won", endedISO: new Date(2026, 0, 15).toISOString() }),
    ];
    const buckets = bucketVelocity(
      experiments,
      { startDate, endDate },
      "month",
    );
    const totalWon = buckets.reduce((a, b) => a + b.won, 0);
    expect(totalWon).toBe(1);
  });
});

describe("computeWinRateSummary", () => {
  it("computes wins/losses/other and win rate over stopped experiments", () => {
    const experiments = [
      exp({ results: "won" }),
      exp({ results: "won" }),
      exp({ results: "lost" }),
      exp({ results: "inconclusive" }),
    ];
    const s = computeWinRateSummary(experiments);
    expect(s).toMatchObject({ wins: 2, losses: 1, other: 1, total: 4 });
    expect(s.winRate).toBe(50);
  });
  it("returns a 0 win rate with no experiments", () => {
    expect(computeWinRateSummary([]).winRate).toBe(0);
  });
});

describe("computeWinRateByProject", () => {
  const projects = [
    { id: "p1", name: "Alpha" },
    { id: "p2", name: "Beta" },
  ];

  it("prepends an All Projects row when nothing is selected", () => {
    const experiments = [
      exp({ results: "won", project: "p1" }),
      exp({ results: "lost", project: "p1" }),
      exp({ results: "won", project: "p2" }),
    ];
    const rows = computeWinRateByProject(experiments, [], projects);
    expect(rows[0]).toMatchObject({ id: "all", wins: 2, losses: 1, total: 3 });
    const p1 = rows.find((r) => r.id === "p1");
    expect(p1).toMatchObject({ wins: 1, losses: 1, total: 2, winRate: 50 });
  });

  it("filters to selected projects and omits the All Projects row", () => {
    const experiments = [
      exp({ results: "won", project: "p1" }),
      exp({ results: "won", project: "p2" }),
    ];
    const rows = computeWinRateByProject(experiments, ["p2"], projects);
    expect(rows.map((r) => r.id)).toEqual(["p2"]);
    expect(rows[0]).toMatchObject({ wins: 1, total: 1, winRate: 100 });
  });
});
