import {
  EXPERIMENT_PROCESS_RULES_VERSION,
  ProcessChange,
  canJudgeProcess,
  evaluateProcessRules,
  hasCurrentProcessResults,
  toProcessSnapshot,
} from "../../src/enterprise/experimentProcess";

const day = 24 * 60 * 60 * 1000;
const t0 = new Date("2026-06-01T00:00:00Z").getTime();
const at = (days: number) => new Date(t0 + days * day);

type Doc = Record<string, unknown>;

const phase = (overrides: Doc = {}) => ({
  dateStarted: at(0),
  coverage: 1,
  condition: "{}",
  variationWeights: [0.5, 0.5],
  seed: "seed-1",
  ...overrides,
});

const draft: Doc = {
  status: "draft",
  trackingKey: "exp-1",
  hypothesis: "If we simplify checkout, conversions go up",
  goalMetrics: ["met_conversions"],
  statusUpdateSchedule: { stopAt: at(14) },
  hashAttribute: "id",
  hashVersion: 2,
  statsEngine: "frequentist",
  phases: [phase()],
};
const running: Doc = { ...draft, status: "running" };
const stopped: Doc = { ...draft, status: "stopped" };

const change = (days: number, pre: Doc, post: Doc): ProcessChange => ({
  date: at(days),
  user: "Sam",
  pre: toProcessSnapshot(pre)!,
  post: toProcessSnapshot(post)!,
});

const evaluate = (
  history: ProcessChange[],
  orgSequentialTestingEnabled = false,
) =>
  Object.fromEntries(
    evaluateProcessRules({ history, orgSequentialTestingEnabled }).map((r) => [
      r.key,
      r,
    ]),
  );

const results = (
  history: ProcessChange[],
  orgSequentialTestingEnabled = false,
) =>
  Object.fromEntries(
    Object.entries(evaluate(history, orgSequentialTestingEnabled)).map(
      ([k, r]) => [k, r.result],
    ),
  );

const cleanRun = [change(0, draft, running), change(14, running, stopped)];

describe("process rules", () => {
  it("passes a clean run", () => {
    expect(results(cleanRun)).toEqual({
      "goal-metrics-locked": "pass",
      "hypothesis-locked": "pass",
      "planned-end": "pass",
      "stable-assignment": "pass",
      "stable-analysis": "pass",
      "no-early-stop": "pass",
      "clean-restarts": "pass",
    });
  });

  it("can't judge anything without history", () => {
    expect(new Set(Object.values(results([])))).toEqual(new Set(["na"]));
  });

  it("fails starting without goal metrics or a hypothesis", () => {
    const bare = { ...draft, goalMetrics: [], hypothesis: " " };
    const r = evaluate([change(0, bare, { ...bare, status: "running" })]);
    expect(r["goal-metrics-locked"].result).toBe("fail");
    expect(r["goal-metrics-locked"].detail).toBe(
      "Started without goal metrics",
    );
    expect(r["hypothesis-locked"].detail).toBe("Started without a hypothesis");
  });

  it("fails goal metric and hypothesis changes while running, not after", () => {
    const edited = {
      ...running,
      goalMetrics: ["met_revenue"],
      hypothesis: "Something else",
    };
    const whileRunning = evaluate([
      change(0, draft, running),
      change(5, running, edited),
    ]);
    expect(whileRunning["goal-metrics-locked"]).toMatchObject({
      result: "fail",
      detail: "Goal metrics changed while running",
      user: "Sam",
    });
    expect(whileRunning["hypothesis-locked"].result).toBe("fail");

    const afterStop = results([
      ...cleanRun,
      change(20, stopped, { ...edited, status: "stopped" }),
    ]);
    expect(afterStop["goal-metrics-locked"]).toBe("pass");
    expect(afterStop["hypothesis-locked"]).toBe("pass");
  });

  it("fails starting without a planned end", () => {
    const unplanned = { ...draft, statusUpdateSchedule: null };
    const r = results([
      change(0, unplanned, { ...unplanned, status: "running" }),
      change(
        3,
        { ...unplanned, status: "running" },
        { ...unplanned, status: "stopped" },
      ),
    ]);
    expect(r["planned-end"]).toBe("fail");
    // Without a plan there's nothing to stop early against
    expect(r["no-early-stop"]).toBe("na");
  });

  it("fails a traffic split change within a phase but not a coverage ramp", () => {
    const resplit = {
      ...running,
      phases: [phase({ variationWeights: [0.8, 0.2] })],
    };
    const r = evaluate([
      change(0, draft, running),
      change(3, running, resplit),
    ]);
    expect(r["stable-assignment"]).toMatchObject({
      result: "fail",
      detail: "Changed the traffic split while running",
    });

    const ramped = { ...running, phases: [phase({ coverage: 0.5 })] };
    expect(
      results([change(0, draft, running), change(3, running, ramped)])[
        "stable-assignment"
      ],
    ).toBe("pass");
  });

  it("judges new phases by whether they re-randomized", () => {
    const reseeded = {
      ...running,
      phases: [
        phase(),
        phase({ seed: "seed-2", variationWeights: [0.8, 0.2] }),
      ],
    };
    const clean = results([
      change(0, draft, running),
      change(3, running, reseeded),
    ]);
    expect(clean["clean-restarts"]).toBe("pass");
    // A new phase isn't a mid-phase change
    expect(clean["stable-assignment"]).toBe("pass");

    const sameSeed = { ...running, phases: [phase(), phase()] };
    expect(
      evaluate([change(0, draft, running), change(3, running, sameSeed)])[
        "clean-restarts"
      ],
    ).toMatchObject({
      result: "fail",
      detail: "Started a new phase without re-randomizing",
    });
  });

  it("fails analysis setting changes while running", () => {
    const bayesian = { ...running, statsEngine: "bayesian" };
    expect(
      evaluate([change(0, draft, running), change(4, running, bayesian)])[
        "stable-analysis"
      ],
    ).toMatchObject({
      result: "fail",
      detail: "Changed the statistics engine while running",
    });
  });

  it("fails stopping before the planned end unless sequential testing is on", () => {
    const early = [change(0, draft, running), change(11, running, stopped)];
    expect(evaluate(early)["no-early-stop"]).toMatchObject({
      result: "fail",
      detail: "Stopped 3 days before its planned end",
    });
    // Org default sequential testing makes early stopping valid
    expect(results(early, true)["no-early-stop"]).toBe("na");
    // ...unless the experiment turned it off
    const off = { ...running, sequentialTestingEnabled: false };
    expect(
      results(
        [change(0, draft, off), change(11, off, { ...off, status: "stopped" })],
        true,
      )["no-early-stop"],
    ).toBe("fail");
  });
});

describe("canJudgeProcess and hasCurrentProcessResults", () => {
  it("judges stopped standard experiments with current results", () => {
    expect(canJudgeProcess({ status: "stopped" })).toBe(true);
    expect(canJudgeProcess({ status: "running" })).toBe(false);
    expect(
      canJudgeProcess({ status: "stopped", type: "multi-armed-bandit" }),
    ).toBe(false);
    expect(
      hasCurrentProcessResults({
        processResults: { version: EXPERIMENT_PROCESS_RULES_VERSION },
      }),
    ).toBe(true);
    expect(hasCurrentProcessResults({ processResults: { version: 0 } })).toBe(
      false,
    );
    expect(hasCurrentProcessResults({})).toBe(false);
  });
});

describe("toProcessSnapshot", () => {
  it("returns null for anything that isn't an experiment", () => {
    expect(toProcessSnapshot(null)).toBeNull();
    expect(toProcessSnapshot("experiment")).toBeNull();
  });
});
