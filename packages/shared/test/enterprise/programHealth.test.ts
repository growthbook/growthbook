import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import {
  combineProjectScores,
  computeHealthDetails,
  computeScopeHealth,
  getHealthBand,
} from "../../src/enterprise/insights/programHealth";
import { ExperimentQualityScoreResult } from "../../src/enterprise/experimentQualityScore";

const NOW = new Date("2026-10-01T00:00:00Z");
const WINDOW = {
  startDate: new Date("2026-07-03T00:00:00Z"),
  endDate: NOW,
};
const HEALTH_SETTINGS = {
  decisionFrameworkEnabled: false,
  experimentMinLengthDays: 7,
  srmThreshold: 0.001,
  multipleExposureMinPercent: 0.01,
};

let nextId = 0;
function exp(
  overrides: Partial<ExperimentInterfaceStringDates> & {
    started?: string;
    ended?: string;
    phaseCount?: number;
  } = {},
): ExperimentInterfaceStringDates {
  const { started = "2026-08-01", ended, phaseCount = 1, ...rest } = overrides;
  const phases = Array.from({ length: phaseCount }, (_, i) => ({
    name: i === phaseCount - 1 ? "Main" : `Phase ${i}`,
    dateStarted: `${started}T00:00:00Z`,
    dateEnded:
      i < phaseCount - 1 || ended ? `${ended ?? started}T00:00:00Z` : undefined,
  }));
  return {
    id: `exp_${nextId++}`,
    name: "Experiment",
    project: "",
    owner: "",
    type: "standard",
    status: ended ? "stopped" : "running",
    results: ended ? "won" : undefined,
    archived: false,
    dateCreated: "2026-07-20T00:00:00Z",
    lastSnapshotAttempt: NOW.toISOString(),
    variations: [{ id: "v0" }, { id: "v1" }],
    phases,
    ...rest,
  } as unknown as ExperimentInterfaceStringDates;
}

const noQuality = () => null;
const qualityOf = (score: number) => (): ExperimentQualityScoreResult =>
  ({ score, sections: [] }) as unknown as ExperimentQualityScoreResult;

describe("getHealthBand", () => {
  it("maps scores to bands", () => {
    expect(getHealthBand(95)).toBe("strong");
    expect(getHealthBand(80)).toBe("healthy");
    expect(getHealthBand(65)).toBe("needs-attention");
    expect(getHealthBand(40)).toBe("at-risk");
  });
});

describe("computeScopeHealth", () => {
  const completed = (n: number, results = "won") =>
    Array.from({ length: n }, () =>
      exp({ ended: "2026-09-01", results } as never),
    );

  it("withholds the score below five completed experiments", () => {
    const health = computeScopeHealth({
      experiments: completed(4),
      window: WINDOW,
      healthSettings: HEALTH_SETTINGS,
      getQuality: noQuality,
    });
    expect(health.completed).toBe(4);
    expect(health.score).toBeNull();
  });

  it("averages velocity against the prior six months with quality", () => {
    // 6 starts in the prior six months is 1 per month; 5 this period beats it
    const baseline = Array.from({ length: 6 }, () =>
      exp({ started: "2026-03-01", ended: "2026-04-01" }),
    );
    const experiments = [
      ...baseline,
      ...completed(3),
      exp({ ended: "2026-09-01", results: "lost" } as never),
      exp({ ended: "2026-09-01", results: "inconclusive" } as never),
    ];
    const health = computeScopeHealth({
      experiments,
      window: WINDOW,
      healthSettings: HEALTH_SETTINGS,
      getQuality: qualityOf(60),
    });
    expect(health.completed).toBe(5);
    expect(health.winRate).toBeCloseTo(3 / 5);
    expect(health.quality).toBe(60);
    expect(health.velocityScore).toBe(100);
    expect(health.score).toBe(80);
  });

  it("uses velocity alone when quality scoring is off", () => {
    const health = computeScopeHealth({
      experiments: completed(5),
      window: WINDOW,
      healthSettings: HEALTH_SETTINGS,
      getQuality: noQuality,
    });
    expect(health.quality).toBeNull();
    expect(health.score).toBe(Math.round(health.velocityScore));
  });

  it("counts SRM as a health error but not a missing power target", () => {
    const srm = exp({
      ended: "2026-09-01",
      analysisSummary: {
        health: { srm: 0, multipleExposures: 0, totalUsers: 10000 },
      },
    } as never);
    const health = computeScopeHealth({
      experiments: [srm, exp({ ended: "2026-09-01" })],
      window: WINDOW,
      healthSettings: HEALTH_SETTINGS,
      getQuality: noQuality,
    });
    expect(health.healthyRate).toBe(0.5);
  });
});

describe("combineProjectScores", () => {
  it("weights project scores by completed experiments", () => {
    const row = (score: number | null, completed: number) => ({
      project: "",
      health: { score, completed } as never,
    });
    expect(combineProjectScores([row(90, 3), row(60, 1), row(null, 9)])).toBe(
      83,
    );
    expect(combineProjectScores([row(null, 2)])).toBeNull();
  });
});

describe("computeHealthDetails", () => {
  it("classifies runs and lists what needs attention", () => {
    const details = computeHealthDetails({
      experiments: [
        exp({ ended: "2026-09-01" }),
        exp({ ended: "2026-09-01", phaseCount: 3 }),
        exp({ ended: "2026-09-01", results: "dnf" } as never),
        exp({ status: "draft", dateCreated: "2026-07-01T00:00:00Z" }),
        exp({ lastSnapshotAttempt: "2026-09-01T00:00:00Z" }),
      ],
      window: WINDOW,
      healthSettings: HEALTH_SETTINGS,
      getQuality: noQuality,
      now: NOW,
    });
    expect(details.stability).toMatchObject({ clean: 1, restarted: 1, dnf: 1 });
    expect(details.stability.mostRestarted[0].restarts).toBe(2);
    expect(details.cycle.stuckDrafts).toBe(1);
    expect(details.attention.map((a) => a.type)).toEqual(["Stale", "Draft"]);
    expect(details.diagnostics.endedEarly).toEqual({ count: 1, total: 3 });
    // A one-month run lands in the fifth 7-day bin
    expect(details.cycle.medianBin).toBe(4);
  });
});
