import { ExperimentPhase, Variation } from "shared/types/experiment";
import { Namespaces } from "shared/types/organization";
import { PostExperimentChangesBody, ReleasePlan } from "shared/validators";
import {
  assessChange,
  detectRisks,
  PhaseDelivery,
  selectReleasePlan,
} from "back-end/src/services/experimentChanges/makeChanges/assessChange";
import {
  buildChange,
  currentDelivery,
  deliveryChanged,
  ExperimentForChange,
  requestedDelivery,
} from "back-end/src/services/experimentChanges/makeChanges/buildChange";
import {
  releasePlanNotAllowedMessage,
  releasePlanRequiredMessage,
} from "back-end/src/services/experimentChanges/makeChanges/makeChanges";

const STARTED = new Date("2026-10-01T00:00:00Z");
const NOW = new Date("2026-10-27T10:42:00Z");
const NEW_SEED = "new-seed";

const NAMESPACES: Namespaces[] = [
  {
    name: "checkout",
    label: "Checkout",
    description: "",
    status: "active",
    format: "multiRange",
    hashAttribute: "id",
    seed: "ns-seed",
  },
  { name: "legacy", label: "Legacy", description: "", status: "active" },
  {
    name: "retired",
    label: "Retired",
    description: "",
    status: "inactive",
    format: "multiRange",
    hashAttribute: "id",
    seed: "s",
  },
];

const variation = (id: string): Variation => ({
  id,
  key: id,
  name: id,
  screenshots: [],
});

type Fixture = ExperimentForChange & { isBandit: boolean };

function makeExperiment({
  phase = {},
  bucketVersion = 1,
  minBucketVersion = 0,
  isBandit = false,
  phases,
}: {
  phase?: Partial<ExperimentPhase>;
  bucketVersion?: number;
  minBucketVersion?: number;
  isBandit?: boolean;
  phases?: ExperimentPhase[];
} = {}): Fixture {
  return {
    isBandit,
    bucketVersion,
    minBucketVersion,
    variations: [variation("v0"), variation("v1")],
    phases: phases ?? [
      {
        name: "Main",
        dateStarted: STARTED,
        reason: "",
        coverage: 1,
        condition: "",
        savedGroups: [],
        prerequisites: [],
        seed: "old-seed",
        variationWeights: [0.5, 0.5],
        variations: [
          { id: "v0", status: "active" },
          { id: "v1", status: "active" },
        ],
        ...phase,
      },
    ],
  };
}

/** What the server does with a request: assess, pick the plan, build the write. */
function run(
  experiment: Fixture,
  body: PostExperimentChangesBody,
  { stickyBucketing = true, live = true } = {},
) {
  const touched = requestedDelivery(body, experiment, NAMESPACES);
  const current = currentDelivery(experiment);
  const proposed = { ...current, ...touched };
  const assessment = assessChange({
    changeType: body.changeType,
    current,
    proposed,
    isBandit: experiment.isBandit,
    stickyBucketing,
    live,
  });
  const selection = selectReleasePlan(assessment, body.releasePlan);
  const changes = selection.ok
    ? buildChange({
        experiment,
        touched,
        plan: selection.plan,
        stickyBucketing,
        newSeed: NEW_SEED,
        now: NOW,
        reason: body.reason,
      })
    : null;
  return { assessment, selection, changes };
}

const plan = (assessment: ReturnType<typeof assessChange>, name: ReleasePlan) =>
  assessment.releasePlans.find((p) => p.plan === name);

const DELIVERY_FIELDS: (keyof PhaseDelivery)[] = [
  "condition",
  "savedGroups",
  "prerequisites",
  "coverage",
  "namespace",
  "variationWeights",
];

function expectOnly(
  before: ExperimentPhase,
  after: ExperimentPhase,
  changed: (keyof PhaseDelivery)[],
) {
  for (const field of DELIVERY_FIELDS) {
    if (changed.includes(field)) {
      expect(after[field]).not.toEqual(before[field]);
    } else {
      expect(after[field]).toEqual(before[field]);
    }
  }
}

describe("Make Changes benchmark scenarios", () => {
  it("1. raising traffic applies in place", () => {
    const exp = makeExperiment({ phase: { coverage: 0.5 } });
    const { assessment, selection, changes } = run(exp, {
      changeType: "coverage",
      coverage: 1,
    });
    expect(assessment.requiresReleasePlan).toBe(false);
    expect(selection).toEqual({ ok: true, plan: null });
    expect(changes?.phases).toHaveLength(1);
    expect(changes?.phases?.[0].seed).toBe("old-seed");
    expect(changes?.bucketVersion).toBeUndefined();
    expectOnly(exp.phases[0], changes!.phases![0], ["coverage"]);
  });

  it("2. cutting traffic with Sticky Bucketing keeps assignments", () => {
    const exp = makeExperiment();
    const blocked = run(exp, { changeType: "coverage", coverage: 0.5 });
    expect(blocked.selection).toEqual({ ok: false, reason: "required" });
    expect(blocked.assessment.recommendedReleasePlan).toBe(
      "same-phase-keep-assignments",
    );
    expect(blocked.assessment.risks.map((r) => r.code)).toEqual([
      "decrease-coverage",
    ]);

    const { changes } = run(exp, {
      changeType: "coverage",
      coverage: 0.5,
      releasePlan: "same-phase-keep-assignments",
    });
    expect(changes?.phases).toHaveLength(1);
    expect(changes?.phases?.[0].seed).toBe("old-seed");
    expect(changes?.bucketVersion).toBeUndefined();
    expect(changes?.minBucketVersion).toBeUndefined();
    expectOnly(exp.phases[0], changes!.phases![0], ["coverage"]);
  });

  it("3. cutting traffic without Sticky Bucketing starts a new phase", () => {
    const exp = makeExperiment();
    const options = { stickyBucketing: false };
    const blocked = run(
      exp,
      { changeType: "coverage", coverage: 0.5 },
      options,
    );
    expect(blocked.assessment.recommendedReleasePlan).toBe(
      "new-phase-rerandomize",
    );

    const { changes } = run(
      exp,
      {
        changeType: "coverage",
        coverage: 0.5,
        releasePlan: "new-phase-rerandomize",
      },
      options,
    );
    expect(changes?.phases).toHaveLength(2);
    expect(changes?.phases?.[0].dateEnded).toEqual(NOW);
    expect(changes?.phases?.[1].seed).toBe(NEW_SEED);
    expect(changes?.phases?.[1].dateStarted).toEqual(NOW);
    // Bucket versions only matter to Sticky Bucketing.
    expect(changes?.bucketVersion).toBeUndefined();
    expectOnly(exp.phases[0], changes!.phases![1], ["coverage"]);
  });

  it("4. changing weights starts a new phase", () => {
    const exp = makeExperiment();
    const body: PostExperimentChangesBody = {
      changeType: "weights",
      trafficSplit: [
        { variationId: "v0", weight: 0.7 },
        { variationId: "v1", weight: 0.3 },
      ],
    };
    const blocked = run(exp, body);
    expect(blocked.assessment.recommendedReleasePlan).toBe(
      "new-phase-rerandomize",
    );
    expect(
      plan(blocked.assessment, "same-phase-keep-assignments")
        ?.unavailableReason,
    ).toBe("unsafe-for-change-type");

    const { changes } = run(exp, {
      ...body,
      releasePlan: "new-phase-rerandomize",
    });
    expect(changes?.phases).toHaveLength(2);
    expect(changes?.phases?.[1].seed).toBe(NEW_SEED);
    expect(changes?.phases?.[1].variationWeights).toEqual([0.7, 0.3]);
    expect(changes?.bucketVersion).toBe(2);
    expect(changes?.minBucketVersion).toBeUndefined();
    expectOnly(exp.phases[0], changes!.phases![1], ["variationWeights"]);
  });

  it("5. narrowing targeting with Sticky Bucketing keeps assignments", () => {
    const exp = makeExperiment();
    const blocked = run(exp, {
      changeType: "targeting",
      targetingCondition: '{"country":"US"}',
    });
    expect(blocked.assessment.recommendedReleasePlan).toBe(
      "same-phase-keep-assignments",
    );
    expect(blocked.assessment.risks.map((r) => r.code)).toEqual([
      "more-restrictive-targeting",
    ]);

    const { changes } = run(exp, {
      changeType: "targeting",
      targetingCondition: '{"country":"US"}',
      releasePlan: "same-phase-keep-assignments",
    });
    expect(changes?.phases).toHaveLength(1);
    expect(changes?.phases?.[0].condition).toBe('{"country":"US"}');
    expectOnly(exp.phases[0], changes!.phases![0], ["condition"]);
  });

  it("6. removing a condition applies in place", () => {
    const exp = makeExperiment({ phase: { condition: '{"country":"US"}' } });
    const { assessment, selection, changes } = run(exp, {
      changeType: "targeting",
      targetingCondition: null,
    });
    expect(assessment.requiresReleasePlan).toBe(false);
    expect(selection).toEqual({ ok: true, plan: null });
    expect(changes?.phases?.[0].condition).toBe("");
    expectOnly(exp.phases[0], changes!.phases![0], ["condition"]);
  });

  it("7. moving into a namespace starts a new phase", () => {
    const exp = makeExperiment();
    const body: PostExperimentChangesBody = {
      changeType: "namespace",
      namespace: { namespaceId: "checkout", ranges: [[0, 0.5]] },
    };
    const blocked = run(exp, body);
    expect(blocked.assessment.recommendedReleasePlan).toBe(
      "new-phase-rerandomize",
    );
    expect(blocked.assessment.risks.map((r) => r.code)).toEqual([
      "add-to-namespace",
    ]);

    const { changes } = run(exp, {
      ...body,
      releasePlan: "new-phase-rerandomize",
    });
    expect(changes?.phases).toHaveLength(2);
    expect(changes?.phases?.[1].namespace).toEqual({
      enabled: true,
      name: "checkout",
      format: "multiRange",
      hashAttribute: "id",
      ranges: [[0, 0.5]],
    });
    expectOnly(exp.phases[0], changes!.phases![1], ["namespace"]);
  });

  it("8. starting a new phase re-randomizes", () => {
    const exp = makeExperiment({ phase: { coverage: 0.8 } });
    const blocked = run(exp, { changeType: "new-phase" });
    expect(blocked.selection).toEqual({ ok: false, reason: "required" });
    expect(blocked.assessment.recommendedReleasePlan).toBe(
      "new-phase-rerandomize",
    );
    expect(blocked.assessment.releasePlans.map((p) => p.plan)).toEqual([
      "new-phase-rerandomize",
      "new-phase-keep-assignments",
    ]);

    const { changes } = run(exp, {
      changeType: "new-phase",
      releasePlan: "new-phase-rerandomize",
      reason: "Fixed the checkout bug",
    });
    expect(changes?.phases).toHaveLength(2);
    expect(changes?.phases?.[0].reason).toBe("Fixed the checkout bug");
    expect(changes?.phases?.[1].seed).toBe(NEW_SEED);
    expect(changes?.phases?.[1].reason).toBe("");
    expectOnly(exp.phases[0], changes!.phases![1], []);
  });

  it("9. narrowing a Bandit's targeting starts a new phase", () => {
    const exp = makeExperiment({ isBandit: true });
    const body: PostExperimentChangesBody = {
      changeType: "targeting",
      targetingCondition: '{"deviceType":"mobile"}',
    };
    const blocked = run(exp, body);
    expect(blocked.selection).toEqual({ ok: false, reason: "required" });
    expect(blocked.assessment.recommendedReleasePlan).toBe(
      "new-phase-rerandomize",
    );
    expect(blocked.assessment.risks.map((r) => r.code)).toEqual([
      "more-restrictive-targeting",
      "bandit-restart",
    ]);
    expect(
      plan(blocked.assessment, "same-phase-keep-assignments")
        ?.unavailableReason,
    ).toBe("unsafe-for-change-type");
    expect(blocked.assessment.releasePlans.every((p) => p.banditRestarts)).toBe(
      true,
    );

    const { changes } = run(exp, {
      ...body,
      releasePlan: "new-phase-rerandomize",
    });
    expect(changes?.phases).toHaveLength(2);
    expect(changes?.phases?.[1].seed).toBe(NEW_SEED);
    expectOnly(exp.phases[0], changes!.phases![1], ["condition"]);
  });

  it("10. advanced lets weights change in the same phase, with the bias spelled out", () => {
    const exp = makeExperiment();
    const fields = {
      trafficSplit: [
        { variationId: "v0", weight: 0.7 },
        { variationId: "v1", weight: 0.3 },
      ],
      releasePlan: "same-phase-keep-assignments" as const,
    };
    const asWeights = run(exp, { changeType: "weights", ...fields });
    expect(asWeights.selection).toEqual({
      ok: false,
      reason: "not-allowed",
      rejection: "unsafe-for-change-type",
    });

    const { assessment, changes } = run(exp, {
      changeType: "advanced",
      ...fields,
    });
    expect(plan(assessment, "same-phase-keep-assignments")).toMatchObject({
      available: true,
      bias: "high-risk",
    });
    expect(assessment.risks.map((r) => r.code)).toEqual([
      "change-variation-weights",
      "multiple-changes",
    ]);
    expect(changes?.phases).toHaveLength(1);
    expect(changes?.phases?.[0].seed).toBe("old-seed");
    expect(changes?.bucketVersion).toBeUndefined();
    expectOnly(exp.phases[0], changes!.phases![0], ["variationWeights"]);
  });

  it("11. a draft applies directly", () => {
    const exp = makeExperiment();
    const { assessment, selection, changes } = run(
      exp,
      { changeType: "coverage", coverage: 0.5 },
      { live: false },
    );
    expect(assessment.requiresReleasePlan).toBe(false);
    expect(assessment.risks).toEqual([]);
    expect(selection).toEqual({ ok: true, plan: null });
    expectOnly(exp.phases[0], changes!.phases![0], ["coverage"]);
  });

  it("12. keeping assignments without Sticky Bucketing is refused with the plans that can run", () => {
    const exp = makeExperiment();
    const { assessment, selection, changes } = run(
      exp,
      {
        changeType: "coverage",
        coverage: 0.5,
        releasePlan: "same-phase-keep-assignments",
      },
      { stickyBucketing: false },
    );
    expect(changes).toBeNull();
    expect(selection).toEqual({
      ok: false,
      reason: "not-allowed",
      rejection: "requires-sticky-bucketing",
    });
    expect(
      assessment.releasePlans.filter((p) => p.available).map((p) => p.plan),
    ).toEqual(["new-phase-rerandomize", "same-phase-reassign"]);
    expect(assessment.recommendedReleasePlan).toBe("new-phase-rerandomize");
  });
});

describe("assessChange", () => {
  const base: PhaseDelivery = currentDelivery(makeExperiment());

  it.each([
    ["sticky, safe change", true, {}, "same-phase-keep-assignments", false],
    ["no sticky, safe change", false, {}, "same-phase-reassign", false],
    [
      "sticky, cut",
      true,
      { coverage: 0.5 },
      "same-phase-keep-assignments",
      true,
    ],
    ["no sticky, cut", false, { coverage: 0.5 }, "new-phase-rerandomize", true],
    [
      "sticky, ambiguous targeting",
      true,
      { savedGroups: [{ match: "all" as const, ids: ["b"] }] },
      "new-phase-rerandomize",
      true,
    ],
  ])("%s", (_label, stickyBucketing, change, recommended, required) => {
    const current = {
      ...base,
      savedGroups: [{ match: "all" as const, ids: ["a"] }],
    };
    const assessment = assessChange({
      changeType: "advanced",
      current,
      proposed: { ...current, ...change },
      isBandit: false,
      stickyBucketing,
      live: true,
    });
    expect(assessment.recommendedReleasePlan).toBe(recommended);
    expect(assessment.requiresReleasePlan).toBe(required);
    expect(plan(assessment, recommended as ReleasePlan)?.available).toBe(true);
  });

  it("never recommends an unavailable plan", () => {
    for (const stickyBucketing of [true, false]) {
      for (const isBandit of [true, false]) {
        for (const change of [
          {},
          { coverage: 0.5 },
          { condition: '{"a":1}' },
          { variationWeights: [0.7, 0.3] },
        ]) {
          const assessment = assessChange({
            changeType: "advanced",
            current: base,
            proposed: { ...base, ...change },
            isBandit,
            stickyBucketing,
            live: true,
          });
          expect(
            plan(assessment, assessment.recommendedReleasePlan)?.available,
          ).toBe(true);
        }
      }
    }
  });

  it("rates an ambiguous targeting change by Sticky Bucketing", () => {
    const current = {
      ...base,
      savedGroups: [{ match: "all" as const, ids: ["a"] }],
    };
    const proposed = {
      ...current,
      savedGroups: [{ match: "all" as const, ids: ["b"] }],
    };
    const input = {
      changeType: "targeting" as const,
      current,
      proposed,
      isBandit: false,
      live: true,
    };
    const sticky = assessChange({ ...input, stickyBucketing: true });
    expect(plan(sticky, "same-phase-keep-assignments")).toMatchObject({
      available: true,
      bias: "may-bias",
    });
    expect(plan(sticky, "same-phase-reassign")?.bias).toBe("high-risk");

    const noSticky = assessChange({ ...input, stickyBucketing: false });
    expect(plan(noSticky, "same-phase-reassign")?.unavailableReason).toBe(
      "unsafe-for-change-type",
    );
  });

  it("lets a Bandit cut traffic in the same phase", () => {
    const assessment = assessChange({
      changeType: "coverage",
      current: base,
      proposed: { ...base, coverage: 0.5 },
      isBandit: true,
      stickyBucketing: false,
      live: true,
    });
    expect(assessment.requiresReleasePlan).toBe(false);
    expect(assessment.recommendedReleasePlan).toBe(
      "same-phase-keep-assignments",
    );
    expect(assessment.releasePlans.map((p) => p.plan)).toEqual([
      "new-phase-rerandomize",
      "same-phase-keep-assignments",
    ]);
  });

  it("only offers excluding exposed users under advanced", () => {
    const input = {
      current: base,
      proposed: { ...base, coverage: 0.5 },
      isBandit: false,
      stickyBucketing: true,
      live: true,
    };
    const coverage = assessChange({ ...input, changeType: "coverage" });
    expect(
      selectReleasePlan(coverage, "new-phase-exclude-exposed"),
    ).toMatchObject({ ok: false, rejection: "unsafe-for-change-type" });

    const advanced = assessChange({ ...input, changeType: "advanced" });
    expect(selectReleasePlan(advanced, "new-phase-exclude-exposed")).toEqual({
      ok: true,
      plan: "new-phase-exclude-exposed",
    });
  });

  it("applies a safe change with a named plan", () => {
    const assessment = assessChange({
      changeType: "coverage",
      current: { ...base, coverage: 0.5 },
      proposed: { ...base, coverage: 1 },
      isBandit: false,
      stickyBucketing: true,
      live: true,
    });
    expect(selectReleasePlan(assessment, "new-phase-rerandomize")).toEqual({
      ok: true,
      plan: "new-phase-rerandomize",
    });
  });
});

describe("detectRisks", () => {
  const base = currentDelivery(makeExperiment());
  const risks = (
    current: Partial<PhaseDelivery>,
    next: Partial<PhaseDelivery>,
  ) => detectRisks({ ...base, ...current }, { ...base, ...current, ...next });

  it.each([
    ["removing an ANDed clause", '{"a":1,"b":2}', '{"a":1}', []],
    [
      "adding a clause",
      '{"a":1}',
      '{"a":1,"b":2}',
      ["more-restrictive-targeting"],
    ],
    ["reformatting only", '{"a":1}', '{ "a": 1 }', []],
    ["clearing the condition", '{"a":1}', "", []],
  ])("%s", (_label, current, next, expected) => {
    expect(risks({ condition: current }, { condition: next })).toEqual(
      expected,
    );
  });

  it("reads Saved Groups by restrictiveness", () => {
    const groups = (ids: string[]) => [{ match: "all" as const, ids }];
    expect(
      risks(
        { savedGroups: groups(["a"]) },
        { savedGroups: groups(["a", "b"]) },
      ),
    ).toEqual(["more-restrictive-targeting"]);
    expect(
      risks(
        { savedGroups: groups(["a", "b"]) },
        { savedGroups: groups(["a"]) },
      ),
    ).toEqual([]);
    expect(
      risks({ savedGroups: groups(["a"]) }, { savedGroups: groups(["b"]) }),
    ).toEqual(["ambiguous-targeting-change"]);
  });

  it("reads namespace ranges", () => {
    const ns = (ranges: [number, number][]) => ({
      enabled: true,
      name: "checkout",
      format: "multiRange" as const,
      ranges,
    });
    expect(
      risks({ namespace: ns([[0, 0.5]]) }, { namespace: ns([[0, 1]]) }),
    ).toEqual([]);
    expect(
      risks({ namespace: ns([[0, 0.5]]) }, { namespace: ns([[0, 0.25]]) }),
    ).toEqual(["decrease-namespace-range"]);
    expect(
      risks(
        { namespace: ns([[0, 0.5]]) },
        { namespace: { enabled: false, name: "", range: [0, 1] } },
      ),
    ).toEqual([]);
  });
});

describe("requestedDelivery", () => {
  const exp = makeExperiment({
    phase: {
      condition: '{"a":1}',
      savedGroups: [{ match: "all", ids: ["g"] }],
      prerequisites: [{ id: "f", condition: "{}" }],
    },
  });

  it("keeps omitted fields and clears nulls", () => {
    expect(
      requestedDelivery(
        { targetingCondition: null, savedGroups: null },
        exp,
        NAMESPACES,
      ),
    ).toEqual({ condition: "", savedGroups: [] });
  });

  it("maps trafficSplit by variation id", () => {
    expect(
      requestedDelivery(
        {
          trafficSplit: [
            { variationId: "v1", weight: 0.3 },
            { variationId: "v0", weight: 0.7 },
          ],
        },
        exp,
        NAMESPACES,
      ).variationWeights,
    ).toEqual([0.7, 0.3]);
  });

  it.each([
    [
      [
        { variationId: "v9", weight: 1 },
        { variationId: "v0", weight: 0 },
      ],
      /Unknown variationId: v9/,
    ],
    [
      [
        { variationId: "v0", weight: 0.5 },
        { variationId: "v0", weight: 0.5 },
      ],
      /one weight per variation/,
    ],
    [
      [
        { variationId: "v0", weight: 0.5 },
        { variationId: "v1", weight: 0.2 },
      ],
      /sum to 1/,
    ],
  ])("rejects a bad trafficSplit", (trafficSplit, message) => {
    expect(() => requestedDelivery({ trafficSplit }, exp, NAMESPACES)).toThrow(
      message,
    );
  });

  it("rejects a condition that isn't a JSON object", () => {
    expect(() =>
      requestedDelivery({ targetingCondition: "[1]" }, exp, NAMESPACES),
    ).toThrow(/JSON object/);
  });

  it("checks the namespace against the organization", () => {
    expect(() =>
      requestedDelivery(
        { namespace: { namespaceId: "nope", ranges: [[0, 1]] } },
        exp,
        NAMESPACES,
      ),
    ).toThrow(/not found/);
    expect(() =>
      requestedDelivery(
        { namespace: { namespaceId: "retired", ranges: [[0, 1]] } },
        exp,
        NAMESPACES,
      ),
    ).toThrow(/inactive/);
    expect(() =>
      requestedDelivery(
        {
          namespace: {
            namespaceId: "legacy",
            ranges: [
              [0, 0.2],
              [0.5, 0.7],
            ],
          },
        },
        exp,
        NAMESPACES,
      ),
    ).toThrow(/single-range/);
    expect(
      requestedDelivery(
        { namespace: { namespaceId: "legacy", ranges: [[0, 0.2]] } },
        exp,
        NAMESPACES,
      ).namespace,
    ).toEqual({ enabled: true, name: "legacy", range: [0, 0.2] });
  });
});

describe("deliveryChanged", () => {
  const current = currentDelivery(
    makeExperiment({ phase: { condition: '{"a":1}' } }),
  );

  it("ignores reformatting and an unset namespace being cleared", () => {
    expect(
      deliveryChanged(current, {
        ...current,
        condition: '{ "a": 1 }',
        namespace: { enabled: false, name: "", range: [0, 1] },
      }),
    ).toBe(false);
  });

  it("sees a real change", () => {
    expect(deliveryChanged(current, { ...current, coverage: 0.4 })).toBe(true);
  });
});

describe("buildChange", () => {
  const input = {
    touched: {},
    stickyBucketing: true,
    newSeed: NEW_SEED,
    now: NOW,
  };

  it.each([
    ["same-phase-keep-assignments", 1, 0],
    ["same-phase-reassign", 2, 0],
    ["new-phase-rerandomize", 2, 0],
    ["new-phase-keep-assignments", 1, 0],
    ["new-phase-exclude-exposed", 2, 2],
  ] as const)("%s", (p, bucket, min) => {
    const exp = makeExperiment();
    const changes = buildChange({ ...input, experiment: exp, plan: p });
    expect({
      bucketVersion: changes.bucketVersion ?? exp.bucketVersion,
      minBucketVersion: changes.minBucketVersion ?? exp.minBucketVersion,
    }).toEqual({ bucketVersion: bucket, minBucketVersion: min });
  });

  it("keeps the seed on a new phase that keeps assignments", () => {
    const changes = buildChange({
      ...input,
      experiment: makeExperiment(),
      plan: "new-phase-keep-assignments",
    });
    expect(changes.phases?.[1].seed).toBe("old-seed");
  });

  it("leaves bucket versions alone without Sticky Bucketing", () => {
    const changes = buildChange({
      ...input,
      stickyBucketing: false,
      experiment: makeExperiment(),
      plan: "new-phase-exclude-exposed",
    });
    expect(changes.bucketVersion).toBeUndefined();
    expect(changes.minBucketVersion).toBeUndefined();
  });

  it("gives a draft with no phase its first one", () => {
    const changes = buildChange({
      ...input,
      touched: { coverage: 0.5 },
      experiment: makeExperiment({ phases: [] }),
      plan: null,
    });
    expect(changes.phases).toHaveLength(1);
    expect(changes.phases?.[0]).toMatchObject({
      coverage: 0.5,
      variationWeights: [0.5, 0.5],
      dateStarted: NOW,
      variations: [
        { id: "v0", status: "active" },
        { id: "v1", status: "active" },
      ],
    });
  });
});

describe("release-plan messages", () => {
  const exp = makeExperiment();

  it("names the change, its risks, and how to recover", () => {
    const { assessment } = run(exp, { changeType: "coverage", coverage: 0.5 });
    const message = releasePlanRequiredMessage("coverage", assessment);
    expect(message).toMatch(/^Decreasing traffic needs a `releasePlan`\./);
    expect(message).toContain("Recommended: `same-phase-keep-assignments`.");
    expect(message).toContain("`dryRun: true`");
    expect(message).toContain(assessment.docUrl);
  });

  it("points an unsafe plan to advanced only when advanced accepts it", () => {
    const { assessment } = run(exp, {
      changeType: "weights",
      trafficSplit: [
        { variationId: "v0", weight: 0.7 },
        { variationId: "v1", weight: 0.3 },
      ],
    });
    const args = {
      changeType: "weights" as const,
      plan: "same-phase-keep-assignments" as const,
      rejection: "unsafe-for-change-type" as const,
      assessment,
    };
    expect(
      releasePlanNotAllowedMessage({ ...args, acceptedUnderAdvanced: true }),
    ).toContain('`changeType: "advanced"`');
    expect(
      releasePlanNotAllowedMessage({ ...args, acceptedUnderAdvanced: false }),
    ).not.toContain("advanced");
  });
});
