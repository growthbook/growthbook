import {
  DEFAULT_GRADE_WEIGHTS,
  EXPERIMENTATION_HEALTH_METRICS,
  HealthExperiment,
  computeHealthGrade,
  countHealthOverrides,
  evaluateProcessSignals,
  getAverage,
  getCompletedExperimentsInWindow,
  getExperimentsStartedPerMonth,
  getGradeLetter,
  getHealthTargetError,
  getHealthWindow,
  getIdeasPerMonth,
  getProcessScore,
  getWinRate,
  reflowGradeWeights,
  resolveGradeWeights,
  resolveHealthTargets,
  scoreAgainstTarget,
} from "../../src/enterprise/experimentationHealth";

const NOW = new Date("2026-10-01T00:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86400000);
const window = getHealthWindow(NOW, 90);

describe("resolveHealthTargets", () => {
  it("falls back to the built-in defaults with no records", () => {
    const targets = resolveHealthTargets(null, null);
    expect(targets.averageQualityScore.target).toEqual(
      EXPERIMENTATION_HEALTH_METRICS.averageQualityScore.defaultTarget,
    );
    expect(targets.averageQualityScore.overridden).toBe(false);
  });

  it("lets a Project override one target and inherit the rest", () => {
    const org = { targets: { averageQualityScore: { min: 80, max: null } } };
    const project = { targets: { winRate: { min: 10, max: 40 } } };
    const targets = resolveHealthTargets(org, project);

    expect(targets.averageQualityScore.target).toEqual({ min: 80, max: null });
    expect(targets.averageQualityScore.overridden).toBe(false);
    expect(targets.winRate.target).toEqual({ min: 10, max: 40 });
    expect(targets.winRate.orgTarget).toEqual({ min: 20, max: 30 });
    expect(targets.winRate.overridden).toBe(true);
  });

  it("ignores a stored maximum on a minimum-only metric", () => {
    const targets = resolveHealthTargets(
      { targets: { experimentsStartedPerMonth: { min: 4, max: 10 } } },
      { targets: { experimentsStartedPerMonth: { min: 5, max: 8 } } },
    );
    expect(targets.experimentsStartedPerMonth.orgTarget).toEqual({
      min: 4,
      max: null,
    });
    expect(targets.experimentsStartedPerMonth.target).toEqual({
      min: 5,
      max: null,
    });
  });

  it("treats an explicitly blank Project target as an override", () => {
    const targets = resolveHealthTargets(null, {
      targets: { ideasPerMonth: { min: null, max: null } },
    });
    expect(targets.ideasPerMonth.target).toEqual({ min: null, max: null });
    expect(targets.ideasPerMonth.overridden).toBe(true);
  });
});

describe("resolveGradeWeights", () => {
  it("inherits the weights as one group", () => {
    const org = { gradeWeights: { velocity: 20, quality: 50, process: 30 } };
    expect(resolveGradeWeights(org, null).weights).toEqual(org.gradeWeights);
    expect(resolveGradeWeights(null, null).weights).toEqual(
      DEFAULT_GRADE_WEIGHTS,
    );

    const project = {
      gradeWeights: { velocity: 30, quality: 40, process: 30 },
    };
    const resolved = resolveGradeWeights(org, project);
    expect(resolved.weights).toEqual(project.gradeWeights);
    expect(resolved.orgWeights).toEqual(org.gradeWeights);
    expect(resolved.overridden).toBe(true);
  });
});

describe("reflowGradeWeights", () => {
  it("re-flows the other areas in proportion to keep a total of 100", () => {
    const next = reflowGradeWeights(DEFAULT_GRADE_WEIGHTS, "quality", 40);
    expect(next.quality).toBe(40);
    expect(next.velocity + next.quality + next.process).toBe(100);
    expect(next).toEqual({ velocity: 30, quality: 40, process: 30 });
  });

  it("splits evenly when the others are all zero", () => {
    expect(
      reflowGradeWeights(
        { velocity: 0, quality: 100, process: 0 },
        "quality",
        60,
      ),
    ).toEqual({ velocity: 20, quality: 60, process: 20 });
  });
});

describe("countHealthOverrides", () => {
  it("counts quality fields, targets and the weights group", () => {
    expect(countHealthOverrides(null)).toBe(0);
    expect(
      countHealthOverrides({
        quality: { enabled: false },
        targets: { winRate: { min: 10, max: 40 } },
        gradeWeights: { velocity: 30, quality: 40, process: 30 },
      }),
    ).toBe(3);
  });
});

describe("getHealthTargetError", () => {
  it("rejects a maximum on a minimum-only metric", () => {
    expect(
      getHealthTargetError("experimentsStartedPerMonth", { min: 3, max: 10 }),
    ).toBe("Experiments started per month only takes a minimum");
  });

  it("rejects min > max and out-of-range percentages", () => {
    expect(getHealthTargetError("winRate", { min: 40, max: 20 })).toBe(
      "The minimum can't be greater than the maximum",
    );
    expect(
      getHealthTargetError("averageQualityScore", { min: 120, max: null }),
    ).toBe("Percentages must be between 0 and 100");
    expect(
      getHealthTargetError("experimentsStartedPerMonth", {
        min: 120,
        max: null,
      }),
    ).toBeNull();
    expect(getHealthTargetError("winRate", { min: null, max: null })).toBe(
      null,
    );
  });
});

describe("scoreAgainstTarget", () => {
  it("scores 100 in range and falls off proportionally outside it", () => {
    expect(scoreAgainstTarget(24, { min: 20, max: 30 })).toBe(100);
    expect(scoreAgainstTarget(15, { min: 20, max: 30 })).toBe(75);
    expect(scoreAgainstTarget(40, { min: 20, max: 30 })).toBe(75);
    expect(scoreAgainstTarget(0, { min: 3, max: null })).toBe(0);
  });

  it("is null without a value or a target", () => {
    expect(scoreAgainstTarget(null, { min: 3, max: null })).toBeNull();
    expect(scoreAgainstTarget(5, { min: null, max: null })).toBeNull();
  });
});

describe("getGradeLetter", () => {
  it.each([
    [100, "A+"],
    [95, "A"],
    [91, "A−"],
    [88, "B+"],
    [82, "B"],
    [76, "B−"],
    [72, "C+"],
    [61, "C−"],
    [50, "D+"],
    [10, "D−"],
  ])("%d → %s", (score, letter) => {
    expect(getGradeLetter(score)).toBe(letter);
  });
});

describe("computeHealthGrade", () => {
  const targets = {
    experimentsStartedPerMonth: { min: 4, max: null },
    averageQualityScore: { min: 80, max: null },
    processScore: { min: 80, max: null },
    winRate: { min: 20, max: 30 },
    ideasPerMonth: { min: 20, max: null },
  };
  const values = {
    experimentsStartedPerMonth: 2,
    averageQualityScore: 80,
    processScore: 80,
    winRate: 50,
    ideasPerMonth: 0,
  };

  const gradeWeights = { velocity: 50, quality: 25, process: 25 };

  it("weights only the graded areas", () => {
    // velocity 50, quality 100, process 100; win rate and ideas never count
    const grade = computeHealthGrade({
      values,
      completedCount: 10,
      orgRecord: { targets, gradeWeights },
    });
    expect(grade.areaScores).toEqual({
      velocity: 50,
      quality: 100,
      process: 100,
    });
    expect(grade.score).toBe(75);
    expect(grade.letter).toBe("B−");
  });

  it("drops areas without a target and re-weights the rest", () => {
    const grade = computeHealthGrade({
      values,
      completedCount: 10,
      orgRecord: { targets, gradeWeights },
      projectRecord: {
        targets: { experimentsStartedPerMonth: { min: null, max: null } },
      },
    });
    expect(grade.score).toBe(100);
  });

  it("needs at least 5 completed experiments", () => {
    const grade = computeHealthGrade({
      values,
      completedCount: 4,
      orgRecord: { targets },
    });
    expect(grade.notEnoughData).toBe(true);
    expect(grade.score).toBeNull();
    expect(grade.letter).toBeNull();
  });
});

describe("window metrics", () => {
  const exp = (
    overrides: Partial<HealthExperiment> = {},
  ): HealthExperiment => ({
    status: "stopped",
    phases: [{ dateStarted: daysAgo(60), dateEnded: daysAgo(30) }],
    results: "won",
    ...overrides,
  });

  it("counts first starts per month, ignoring drafts and old starts", () => {
    const experiments = [
      exp(),
      exp({ status: "running", phases: [{ dateStarted: daysAgo(10) }] }),
      exp({ status: "draft", phases: [{ dateStarted: daysAgo(5) }] }),
      exp({ phases: [{ dateStarted: daysAgo(200) }] }),
      // Restarted: the first phase's start is what counts
      exp({
        phases: [
          { dateStarted: daysAgo(120), dateEnded: daysAgo(100) },
          { dateStarted: daysAgo(50) },
        ],
      }),
    ];
    // 2 starts over 90 days = 2 / 3 per month
    expect(getExperimentsStartedPerMonth(experiments, window)).toBeCloseTo(
      2 / 3,
      9,
    );
  });

  it("selects non-archived experiments completed in the window", () => {
    const completed = getCompletedExperimentsInWindow(
      [
        exp(),
        exp({ archived: true }),
        exp({ status: "running" }),
        exp({
          phases: [{ dateStarted: daysAgo(300), dateEnded: daysAgo(200) }],
        }),
      ],
      window,
    );
    expect(completed).toHaveLength(1);
  });

  it("computes win rate, averages and ideas per month", () => {
    expect(
      getWinRate([
        exp(),
        exp({ results: "lost" }),
        exp(),
        exp({ results: "dnf" }),
      ]),
    ).toBe(50);
    expect(getWinRate([])).toBeNull();
    expect(getAverage([60, 80])).toBe(70);
    expect(getAverage([])).toBeNull();
    expect(
      getIdeasPerMonth(
        [daysAgo(1), daysAgo(2), daysAgo(3), daysAgo(400)],
        window,
      ),
    ).toBe(1);
  });
});

describe("process signals", () => {
  const started = daysAgo(60);
  const base: HealthExperiment = {
    status: "stopped",
    phases: [{ dateStarted: started, dateEnded: daysAgo(30) }],
    goalMetrics: ["met_a"],
    hypothesis: "If we do X, Y goes up",
  };
  const beforeStart = { date: daysAgo(70), pre: {}, post: {} };

  it("passes a clean run", () => {
    expect(evaluateProcessSignals(base, [beforeStart])).toEqual({
      "goal-metrics-before-start": true,
      "goal-metrics-unchanged": true,
      "hypothesis-unchanged": true,
      "ran-cleanly": true,
      "not-ended-early": null,
    });
  });

  it("can't judge history-based signals without any history", () => {
    const results = evaluateProcessSignals(base, []);
    expect(results["goal-metrics-before-start"]).toBeNull();
    expect(results["goal-metrics-unchanged"]).toBeNull();
    expect(results["hypothesis-unchanged"]).toBeNull();
    expect(results["ran-cleanly"]).toBe(true);
  });

  it("flags goal metrics added or changed after the start", () => {
    const addedLate = evaluateProcessSignals(base, [
      beforeStart,
      {
        date: daysAgo(50),
        pre: { goalMetrics: [] },
        post: { goalMetrics: ["met_a"] },
      },
    ]);
    expect(addedLate["goal-metrics-before-start"]).toBe(false);
    // Adding the first goal metric is "set late", not "changed"
    expect(addedLate["goal-metrics-unchanged"]).toBe(true);

    const changed = evaluateProcessSignals(base, [
      beforeStart,
      {
        date: daysAgo(50),
        pre: { goalMetrics: ["met_b"] },
        post: { goalMetrics: ["met_a"] },
      },
    ]);
    expect(changed["goal-metrics-before-start"]).toBe(true);
    expect(changed["goal-metrics-unchanged"]).toBe(false);
  });

  it("ignores edits made before the start", () => {
    const results = evaluateProcessSignals(base, [
      {
        date: daysAgo(70),
        pre: { goalMetrics: [], hypothesis: "" },
        post: { goalMetrics: ["met_a"], hypothesis: base.hypothesis },
      },
    ]);
    expect(results["goal-metrics-before-start"]).toBe(true);
    expect(results["hypothesis-unchanged"]).toBe(true);
  });

  it("flags hypothesis edits, restarts, extra phases and early ends", () => {
    const results = evaluateProcessSignals(
      {
        ...base,
        statusUpdateSchedule: { stopAt: daysAgo(10) },
      },
      [
        beforeStart,
        {
          date: daysAgo(40),
          pre: { hypothesis: "old" },
          post: { hypothesis: "new" },
        },
        {
          date: daysAgo(35),
          pre: { status: "stopped" },
          post: { status: "running" },
        },
      ],
    );
    expect(results["hypothesis-unchanged"]).toBe(false);
    expect(results["ran-cleanly"]).toBe(false);
    expect(results["not-ended-early"]).toBe(false);

    expect(
      evaluateProcessSignals(
        {
          ...base,
          phases: [
            { dateStarted: started, dateEnded: daysAgo(40) },
            { dateStarted: daysAgo(40), dateEnded: daysAgo(30) },
          ],
        },
        [],
      )["ran-cleanly"],
    ).toBe(false);
  });

  it("averages each experiment's pass rate, skipping unknowns", () => {
    expect(
      getProcessScore([
        { a: true, b: true, c: null },
        { a: true, b: false, c: null },
        { a: null, b: null, c: null },
      ]),
    ).toBe(75);
    expect(getProcessScore([])).toBeNull();
  });
});
