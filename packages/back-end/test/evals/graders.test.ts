import type {
  ExperimentInterface,
  ExperimentPhase,
} from "shared/types/experiment";
import { gradeCalls, DEFAULT_CALL_RULES } from "./harness/graders/calls";
import { inNamespace, sameAudience, weights } from "./harness/graders/matchers";
import { gradeState, type StateExpectation } from "./harness/graders/state";
import type { ApiCall, WorldSnapshot } from "./harness/record";
import { passHatK } from "./harness/report";

const STARTED = new Date("2026-10-01T00:00:00Z");
const NOW = new Date("2026-10-20T00:00:00Z");

function phase(overrides: Partial<ExperimentPhase> = {}): ExperimentPhase {
  return {
    name: "Main",
    reason: "",
    dateStarted: STARTED,
    coverage: 1,
    condition: "",
    savedGroups: [],
    prerequisites: [],
    namespace: { enabled: false, name: "", range: [0, 1] },
    seed: "checkout-redesign",
    variationWeights: [0.5, 0.5],
    variations: [
      { id: "var_control", status: "active" },
      { id: "var_treatment", status: "active" },
    ],
    ...overrides,
  };
}

function experiment(
  overrides: Partial<ExperimentInterface> = {},
): ExperimentInterface {
  return {
    id: "exp_1",
    name: "Checkout redesign",
    status: "running",
    type: "standard",
    hashAttribute: "id",
    hashVersion: 2,
    disableStickyBucketing: true,
    bucketVersion: 1,
    minBucketVersion: 0,
    phases: [phase()],
    ...overrides,
  } as ExperimentInterface;
}

const snapshot = (
  e: ExperimentInterface,
  orgStickyBucketing = true,
): WorldSnapshot => ({ experiment: e, orgStickyBucketing });

const sticky = experiment({ disableStickyBucketing: false });

const newPhase = (
  before: ExperimentInterface,
  changes: Partial<ExperimentPhase>,
): ExperimentPhase[] => [
  ...before.phases.slice(0, -1),
  { ...before.phases[before.phases.length - 1], dateEnded: NOW },
  phase({ dateStarted: NOW, seed: "new-seed", ...changes }),
];

function grade(
  expect: StateExpectation,
  before: ExperimentInterface,
  after: ExperimentInterface,
) {
  return gradeState(expect, snapshot(before), snapshot(after));
}

describe("gradeState", () => {
  describe("untouched", () => {
    it("passes when only dateUpdated moved", () => {
      const before = experiment();
      expect(
        grade({ plan: "untouched" }, before, { ...before, dateUpdated: NOW })
          .reasons,
      ).toEqual([]);
    });

    it("fails on any other change", () => {
      const before = experiment();
      expect(
        grade({ plan: "untouched" }, before, {
          ...before,
          phases: [phase({ coverage: 0.5 })],
        }).pass,
      ).toBe(false);
    });
  });

  describe("in-place", () => {
    const expect_: StateExpectation = {
      plan: "in-place",
      phase: { coverage: 1 },
    };
    const before = experiment({ phases: [phase({ coverage: 0.5 })] });

    it("passes when only the requested field changed", () => {
      expect(
        grade(expect_, before, { ...before, phases: [phase({ coverage: 1 })] })
          .reasons,
      ).toEqual([]);
    });

    it("fails when the seed is dropped, as a whole-array phase write does", () => {
      expect(
        grade(expect_, before, {
          ...before,
          phases: [phase({ coverage: 1, seed: undefined })],
        }).reasons,
      ).toEqual([expect.stringContaining("seed changed")]);
    });

    it("ignores a condition rewritten from empty to {}", () => {
      expect(
        grade(expect_, before, {
          ...before,
          phases: [phase({ coverage: 1, condition: "{}" })],
        }).reasons,
      ).toEqual([]);
    });

    it("ignores key order in a condition", () => {
      const targeted = experiment({
        phases: [phase({ coverage: 0.5, condition: '{"a":1,"b":2}' })],
      });
      expect(
        grade(expect_, targeted, {
          ...targeted,
          phases: [phase({ coverage: 1, condition: '{ "b": 2, "a": 1 }' })],
        }).reasons,
      ).toEqual([]);
    });

    it("fails when another phase field changed too", () => {
      expect(
        grade(expect_, before, {
          ...before,
          phases: [phase({ coverage: 1, condition: '{"country":"US"}' })],
        }).reasons,
      ).toEqual([expect.stringContaining("phase.condition changed")]);
    });

    it("fails when an experiment field changed too", () => {
      expect(
        grade(expect_, before, {
          ...before,
          hashAttribute: "deviceId",
          phases: [phase({ coverage: 1 })],
        }).reasons,
      ).toEqual([expect.stringContaining("experiment.hashAttribute changed")]);
    });

    it("fails when the requested value is wrong", () => {
      expect(
        grade(expect_, before, {
          ...before,
          phases: [phase({ coverage: 0.9 })],
        }).reasons,
      ).toEqual([expect.stringContaining("phase.coverage is 0.9")]);
    });
  });

  describe("same-phase-keep-assignments", () => {
    const expect_: StateExpectation = {
      plan: "same-phase-keep-assignments",
      phase: { coverage: 0.5 },
    };

    it("passes in the same phase with bucket versions unchanged", () => {
      expect(
        grade(expect_, sticky, {
          ...sticky,
          phases: [phase({ coverage: 0.5 })],
        }).reasons,
      ).toEqual([]);
    });

    it("fails when bucketVersion was bumped, which reassigns sticky users", () => {
      expect(
        grade(expect_, sticky, {
          ...sticky,
          bucketVersion: 2,
          phases: [phase({ coverage: 0.5 })],
        }).reasons,
      ).toEqual([expect.stringContaining("bucketVersion is 2, expected 1")]);
    });

    it("fails when it opened a new phase", () => {
      expect(
        grade(expect_, sticky, {
          ...sticky,
          phases: newPhase(sticky, { coverage: 0.5 }),
        }).reasons,
      ).toEqual([expect.stringContaining("has 2 phases, expected 1")]);
    });
  });

  describe("same-phase-reassign", () => {
    const expect_: StateExpectation = {
      plan: "same-phase-reassign",
      phase: { coverage: 0.5 },
    };

    it("bumps bucketVersion when sticky bucketing applies", () => {
      expect(
        grade(expect_, sticky, {
          ...sticky,
          bucketVersion: 2,
          phases: [phase({ coverage: 0.5 })],
        }).reasons,
      ).toEqual([]);
      expect(
        grade(expect_, sticky, {
          ...sticky,
          phases: [phase({ coverage: 0.5 })],
        }).pass,
      ).toBe(false);
    });

    it("leaves bucket versions alone when sticky bucketing is off", () => {
      const before = experiment();
      expect(
        grade(expect_, before, {
          ...before,
          phases: [phase({ coverage: 0.5 })],
        }).reasons,
      ).toEqual([]);
    });

    it("treats an org with sticky bucketing off as off", () => {
      expect(
        gradeState(
          expect_,
          snapshot(sticky, false),
          snapshot({ ...sticky, phases: [phase({ coverage: 0.5 })] }, false),
        ).reasons,
      ).toEqual([]);
    });
  });

  describe("new-phase-rerandomize", () => {
    const expect_: StateExpectation = {
      plan: "new-phase-rerandomize",
      phase: { coverage: 0.5 },
    };
    const before = experiment();

    it("passes with a closed previous phase and a new seed", () => {
      expect(
        grade(expect_, before, {
          ...before,
          phases: newPhase(before, { coverage: 0.5 }),
        }).reasons,
      ).toEqual([]);
    });

    it("fails when the new phase kept the seed", () => {
      expect(
        grade(expect_, before, {
          ...before,
          phases: newPhase(before, {
            coverage: 0.5,
            seed: "checkout-redesign",
          }),
        }).reasons,
      ).toEqual([expect.stringContaining("expected a new seed")]);
    });

    it("fails when the previous phase was left open", () => {
      const [, added] = newPhase(before, { coverage: 0.5 });
      expect(
        grade(expect_, before, {
          ...before,
          phases: [phase(), added],
        }).reasons,
      ).toEqual([expect.stringContaining("wasn't closed")]);
    });

    it("fails when sticky bucketing applies and bucketVersion stayed put", () => {
      expect(
        grade(expect_, sticky, {
          ...sticky,
          phases: newPhase(sticky, { coverage: 0.5 }),
        }).reasons,
      ).toEqual([expect.stringContaining("bucketVersion is 1, expected 2")]);
    });

    it("fails when an earlier phase was rewritten", () => {
      const twoPhases = experiment({
        phases: [phase({ dateEnded: STARTED, name: "First" }), phase()],
      });
      const after = newPhase(twoPhases, { coverage: 0.5 });
      after[0] = { ...after[0], coverage: 0.2 };
      expect(
        grade(expect_, twoPhases, { ...twoPhases, phases: after }).reasons,
      ).toEqual(["phase 1.coverage changed"]);
    });
  });

  describe("new-phase-keep-assignments", () => {
    const expect_: StateExpectation = { plan: "new-phase-keep-assignments" };
    const before = experiment();

    it("passes with the same seed", () => {
      expect(
        grade(expect_, before, {
          ...before,
          phases: newPhase(before, { seed: "checkout-redesign" }),
        }).reasons,
      ).toEqual([]);
    });

    it("fails with a new seed", () => {
      expect(
        grade(expect_, before, {
          ...before,
          phases: newPhase(before, {}),
        }).reasons,
      ).toEqual([expect.stringContaining("seed changed")]);
    });
  });

  describe("new-phase-exclude-exposed", () => {
    const expect_: StateExpectation = { plan: "new-phase-exclude-exposed" };

    it("raises minBucketVersion to the new bucketVersion", () => {
      const after = { ...sticky, phases: newPhase(sticky, {}) };
      expect(
        grade(expect_, sticky, {
          ...after,
          bucketVersion: 2,
          minBucketVersion: 2,
        }).reasons,
      ).toEqual([]);
      expect(
        grade(expect_, sticky, { ...after, bucketVersion: 2 }).reasons,
      ).toEqual([expect.stringContaining("minBucketVersion is 0, expected 2")]);
    });
  });

  describe("bandits", () => {
    const bandit = experiment({
      type: "multi-armed-bandit",
      banditStage: "exploit",
      phases: [phase({ variationWeights: [0.7, 0.3] })],
    });
    const expect_: StateExpectation = {
      plan: "new-phase-rerandomize",
      phase: { condition: '{"deviceType":"mobile"}' },
    };
    const restarted = (weights: number[]) => ({
      ...bandit,
      banditStage: "explore" as const,
      banditStageDateStarted: NOW,
      phases: newPhase(bandit, {
        condition: '{"deviceType":"mobile"}',
        variationWeights: weights,
      }),
    });

    it("passes when exploration restarts with equal weights", () => {
      expect(grade(expect_, bandit, restarted([0.5, 0.5])).reasons).toEqual([]);
    });

    it("fails when the bandit kept its learned weights", () => {
      expect(grade(expect_, bandit, restarted([0.7, 0.3])).reasons).toEqual([
        expect.stringContaining("expected equal weights"),
      ]);
    });
  });

  describe("stop", () => {
    it("allows the phase to close with a reason", () => {
      const before = experiment();
      expect(
        grade(
          { plan: "stop", experiment: { status: "stopped", winner: 1 } },
          before,
          {
            ...before,
            status: "stopped",
            winner: 1,
            phases: [phase({ dateEnded: NOW, reason: "Treatment won" })],
          },
        ).reasons,
      ).toEqual([]);
    });
  });

  it("reports a missing seed", () => {
    expect(
      gradeState(
        { plan: "untouched" },
        { experiment: null, orgStickyBucketing: false },
        snapshot(experiment()),
      ).reasons,
    ).toEqual(["the seed wrote no experiment"]);
  });
});

describe("gradeCalls", () => {
  const call = (overrides: Partial<ApiCall>): ApiCall => ({
    method: "POST",
    path: "/api/v1/experiments/exp_1",
    status: 200,
    ...overrides,
  });
  const grade = (calls: ApiCall[], before = experiment()) =>
    gradeCalls(DEFAULT_CALL_RULES, calls, snapshot(before));

  it("flags the generic update rewriting a running experiment's phases", () => {
    expect(grade([call({ body: { phases: [] } })]).reasons).toEqual([
      expect.stringContaining("generic experiment update"),
    ]);
  });

  it("allows it on a draft, or when it didn't go through", () => {
    expect(
      grade([call({ body: { phases: [] } })], experiment({ status: "draft" }))
        .pass,
    ).toBe(true);
    expect(grade([call({ body: { phases: [] }, status: 400 })]).pass).toBe(
      true,
    );
  });

  it("flags writes to other experiments but not snapshot refreshes", () => {
    expect(
      grade([call({ path: "/api/v1/experiments/exp_other/stop" })]).reasons,
    ).toEqual([expect.stringContaining("didn't ask about")]);
    expect(
      grade([call({ path: "/api/v1/experiments/exp_other/snapshot" })]).pass,
    ).toBe(true);
  });
});

describe("matchers", () => {
  const COUNTRIES = { country: ["US", "CA", undefined] };

  it("treats equivalent conditions as the same audience", () => {
    const us = sameAudience({ country: "US" }, COUNTRIES);
    expect(us.test('{"country":"US"}')).toBe(true);
    expect(us.test('{"country":{"$eq":"US"}}')).toBe(true);
    expect(us.test('{"country":{"$in":["US"]}}')).toBe(true);
    expect(us.test('{"country":{"$ne":"US"}}')).toBe(false);
    expect(us.test("not json")).toBe(false);
  });

  it("treats an empty condition as everyone", () => {
    const everyone = sameAudience({}, COUNTRIES);
    expect(everyone.test("")).toBe(true);
    expect(everyone.test("{}")).toBe(true);
    expect(everyone.test('{"country":"US"}')).toBe(false);
  });

  it("checks weights within a tolerance", () => {
    expect(weights([0.7, 0.3]).test([0.7, 0.30001])).toBe(true);
    expect(weights([0.7, 0.3]).test([0.3, 0.7])).toBe(false);
  });

  it("accepts either namespace shape", () => {
    const checkout = inNamespace("checkout");
    expect(
      checkout.test({ enabled: true, name: "checkout", range: [0, 0.5] }),
    ).toBe(true);
    expect(
      checkout.test({
        enabled: true,
        name: "checkout",
        ranges: [[0.5, 1]],
        format: "multiRange",
      }),
    ).toBe(true);
    expect(
      checkout.test({ enabled: false, name: "checkout", range: [0, 0.5] }),
    ).toBe(false);
  });
});

describe("passHatK", () => {
  it("is the chance k fresh trials all pass", () => {
    expect(passHatK(3, 3, 3)).toBe(1);
    expect(passHatK(3, 2, 3)).toBe(0);
    expect(passHatK(4, 3, 2)).toBeCloseTo(0.5);
    expect(passHatK(0, 0, 3)).toBe(0);
  });
});
