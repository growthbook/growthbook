import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { ExperimentSnapshotInterface } from "shared/types/experiment-snapshot";
import {
  DAYS_PER_YEAR,
  ExperimentImpactRow,
  buildCounterfactual,
  computeExperimentImpacts,
  rampShare,
  summarizeImpact,
} from "@/enterprise/components/Insights/Impact/impactData";

const METRIC = "fact_revenue";
const SETTINGS = { differenceType: "relative", dimensions: [] };

function exp(
  id: string,
  results: "won" | "lost" | "inconclusive",
  winner = 1,
): ExperimentInterfaceStringDates {
  return {
    id,
    name: id,
    project: "prj_a",
    status: "stopped",
    results,
    winner,
    phases: [
      {
        name: "Main",
        dateStarted: "2026-01-01T00:00:00Z",
        dateEnded: "2026-01-31T00:00:00Z",
      },
    ],
  } as unknown as ExperimentInterfaceStringDates;
}

// One analysis per difference type; `impacts` and `lifts` are per treatment
function snapshot(
  experiment: string,
  impacts: number[] | null,
  lifts: number[] = impacts?.map(() => 0.05) ?? [],
): ExperimentSnapshotInterface {
  const analysis = (differenceType: string, values: number[]) => ({
    status: "success",
    settings: { ...SETTINGS, differenceType },
    results: [
      {
        variations: [0, ...values].map((expected) => ({
          users: 1000,
          metrics: { [METRIC]: { expected, uplift: { stddev: 10 } } },
        })),
      },
    ],
  });
  return {
    experiment,
    analyses: [
      analysis("relative", lifts),
      ...(impacts ? [analysis("scaled", impacts)] : []),
    ],
  } as unknown as ExperimentSnapshotInterface;
}

describe("computeExperimentImpacts", () => {
  it("uses the winning variation for winners and the worst one for losers", () => {
    const rows = computeExperimentImpacts({
      experiments: [
        exp("won", "won", 2),
        exp("lost", "lost"),
        exp("flat", "inconclusive"),
      ],
      snapshots: [
        snapshot("won", [5, 20], [0.01, 0.04]),
        snapshot("lost", [-3, -8]),
        snapshot("flat", [1]),
      ],
      metricId: METRIC,
      inverse: false,
      debias: false,
    });
    const [won, lost, flat] = rows;
    expect(won.dailyImpact).toBe(20);
    expect(won.relativeLift).toBe(0.04);
    expect(won.annualValue).toBe(20 * DAYS_PER_YEAR);
    expect(lost.dailyImpact).toBe(-8);
    expect(lost.annualValue).toBe(8 * DAYS_PER_YEAR);
    expect(flat.annualValue).toBeNull();
  });

  it("treats the highest variation as the worst loser for inverse metrics", () => {
    const [lost] = computeExperimentImpacts({
      experiments: [exp("lost", "lost")],
      snapshots: [snapshot("lost", [3, 8])],
      metricId: METRIC,
      inverse: true,
      debias: false,
    });
    expect(lost.dailyImpact).toBe(8);
  });

  it("flags snapshots that have results but no scaled analysis", () => {
    const [row] = computeExperimentImpacts({
      experiments: [exp("won", "won")],
      snapshots: [snapshot("won", null)],
      metricId: METRIC,
      inverse: false,
      debias: false,
    });
    expect(row.missingScaledImpact).toBe(true);
    expect(row.dailyImpact).toBeNull();
  });

  it("skips experiments whose snapshot doesn't include the metric", () => {
    const missing = snapshot("lost", [1]);
    const variation = missing.analyses[1].results[0].variations[1];
    variation.metrics = {};
    const [row] = computeExperimentImpacts({
      experiments: [exp("lost", "lost")],
      snapshots: [missing],
      metricId: METRIC,
      inverse: false,
      debias: false,
    });
    expect(row.annualValue).toBeNull();
  });

  it("only de-biases with enough experiments, shrinking toward zero", () => {
    const ids = ["a", "b", "c", "d", "e"];
    const run = (n: number, debias: boolean) =>
      computeExperimentImpacts({
        experiments: ids.slice(0, n).map((id) => exp(id, "won")),
        snapshots: ids.map((id, i) => snapshot(id, [10 + i])),
        metricId: METRIC,
        inverse: false,
        debias,
      });
    expect(run(4, true)[0].dailyImpact).toBe(10);
    const shrunk = run(5, true)[0].dailyImpact ?? 0;
    expect(shrunk).toBeLessThan(10);
    expect(shrunk).toBeGreaterThanOrEqual(0);
    expect(run(5, false)[0].dailyImpact).toBe(10);
  });
});

function row(
  result: ExperimentImpactRow["result"],
  annualValue: number | null,
  extra: Partial<ExperimentImpactRow> = {},
): ExperimentImpactRow {
  return {
    id: "x",
    name: "x",
    project: "",
    result,
    startDate: null,
    endDate: null,
    dailyImpact: annualValue === null ? null : annualValue / DAYS_PER_YEAR,
    dailyImpactSE: 0,
    relativeLift: null,
    annualValue,
    missingScaledImpact: false,
    ...extra,
  };
}

describe("summarizeImpact", () => {
  it("totals wins and avoided losses and takes the median win", () => {
    const summary = summarizeImpact([
      row("won", 100),
      row("won", 300),
      row("won", 200),
      row("lost", 50),
      row("other", null),
    ]);
    expect(summary).toMatchObject({
      won: 600,
      wonCount: 3,
      avoidedLoss: 50,
      lostCount: 1,
      total: 650,
      medianWin: 200,
    });
  });
});

describe("rampShare", () => {
  const start = new Date("2026-01-01T00:00:00Z");
  const ship = new Date("2026-01-11T00:00:00Z");
  it("is 0 before the start, linear during the run, 1 after shipping", () => {
    expect(rampShare(new Date("2025-12-31T00:00:00Z"), start, ship)).toBe(0);
    expect(rampShare(new Date("2026-01-06T00:00:00Z"), start, ship)).toBe(0.5);
    expect(rampShare(new Date("2026-02-01T00:00:00Z"), start, ship)).toBe(1);
  });
});

describe("buildCounterfactual", () => {
  const winner = row("won", 10 * DAYS_PER_YEAR, {
    startDate: new Date("2026-01-01T00:00:00Z"),
    endDate: new Date("2026-01-11T00:00:00Z"),
  });

  it("divides out each shipped winner's share of the daily total", () => {
    const series = [
      { date: new Date("2026-01-01T00:00:00Z"), value: 4, total: 100 },
      { date: new Date("2026-01-20T00:00:00Z"), value: 5, total: 100 },
    ];
    const result = buildCounterfactual(series, [winner, row("lost", 99)]);
    expect(result?.points[0].without).toBe(4);
    // 10 per day on a 100 per day total is a 10% lift once shipped
    expect(result?.lift).toBeCloseTo(0.1);
    expect(result?.points[1].without).toBeCloseTo(5 / 1.1);
  });

  it("returns null when the metric has no daily total", () => {
    const series = [{ date: new Date(), value: 1, total: 0 }];
    expect(buildCounterfactual(series, [winner])).toBeNull();
  });
});
