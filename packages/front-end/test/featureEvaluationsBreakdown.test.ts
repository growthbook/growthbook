import { FeatureRule } from "shared/types/feature";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import {
  buildBreakdownRows,
  buildRuleCellResolver,
  buildRuleTrafficSegments,
  buildSeriesColors,
  DEFAULT_RULE_COLOR,
  DEFAULT_RULE_KEY,
  OTHER_GROUP,
  ruleReference,
} from "@/components/Features/featureEvaluationsBreakdown";

const rule = (overrides: Partial<FeatureRule>): FeatureRule =>
  ({
    id: "fr_a",
    type: "force",
    description: "",
    condition: "",
    enabled: true,
    value: "true",
    allEnvironments: true,
    ...overrides,
  }) as FeatureRule;

const noExperiments = new Map<string, ExperimentInterfaceStringDates>();

const RULES = [
  rule({ id: "fr_a", description: "Beta testers" }),
  rule({ id: "fr_b" }),
];

function ruleRows(
  rows: { group: string; evaluations: number }[],
  complete: boolean,
  rules: FeatureRule[] = RULES,
) {
  return buildBreakdownRows({
    dimension: "ruleId",
    rows,
    colors: buildSeriesColors("ruleId", rows, rules),
    complete,
    rules,
    ruleNumberOffset: 1,
    scopeEnvironments: [],
    environmentIds: [],
    experimentsMap: noExperiments,
  });
}

describe("buildBreakdownRows (ruleId)", () => {
  it("reports a true zero only when the dimension is complete", () => {
    const rows = ruleRows([{ group: "fr_a", evaluations: 10 }], true);
    const b = rows.find((r) => r.index === 2);
    expect(b?.count).toBe(0);
  });

  it("reports unknown, not zero, when groups were folded into (other)", () => {
    const rows = ruleRows(
      [
        { group: "fr_a", evaluations: 10 },
        { group: OTHER_GROUP, evaluations: 4 },
      ],
      false,
    );
    expect(rows.find((r) => r.index === 2)?.count).toBeNull();
    expect(rows.find((r) => r.key === DEFAULT_RULE_KEY)?.count).toBeNull();
    expect(rows[rows.length - 1]).toMatchObject({
      key: OTHER_GROUP,
      count: 4,
    });
  });

  it("joins telemetry to env-suffixed rule ids by stem", () => {
    const rows = ruleRows([{ group: "fr_mig", evaluations: 7 }], true, [
      rule({ id: "fr_mig__production", description: "Migrated" }),
    ]);
    expect(rows[0]).toMatchObject({ label: "Migrated", count: 7, index: 1 });
    // Matched, so it is not also listed as a removed rule.
    expect(rows.filter((r) => r.label === "Removed rule")).toHaveLength(0);
  });

  it("lists the default value as a neutral, unnumbered row", () => {
    const rows = ruleRows([{ group: DEFAULT_RULE_KEY, evaluations: 3 }], true);
    const def = rows.find((r) => r.key === DEFAULT_RULE_KEY);
    expect(def).toMatchObject({
      label: "Default Value",
      color: DEFAULT_RULE_COLOR,
      count: 3,
    });
    expect(def?.index).toBeUndefined();
  });

  it("never labels a row with a raw rule id", () => {
    const rows = ruleRows([{ group: "fr_gone", evaluations: 2 }], true);
    expect(rows.find((r) => r.key === "fr_gone")?.label).toBe("Removed rule");
    rows.forEach((r) => expect(r.label).not.toMatch(/^fr_/));
  });

  it("omits out-of-scope rules unless they have traffic", () => {
    const rules = [
      rule({ id: "fr_prod", allEnvironments: false, environments: ["prod"] }),
      rule({ id: "fr_dev", allEnvironments: false, environments: ["dev"] }),
    ];
    const build = (rows: { group: string; evaluations: number }[]) =>
      buildBreakdownRows({
        dimension: "ruleId",
        rows,
        colors: buildSeriesColors("ruleId", rows, rules),
        complete: true,
        rules,
        ruleNumberOffset: 1,
        scopeEnvironments: ["prod"],
        environmentIds: [],
        experimentsMap: noExperiments,
      });
    expect(build([]).map((r) => r.index)).toEqual([1, undefined]);
    expect(
      build([{ group: "fr_dev", evaluations: 1 }]).map((r) => r.index),
    ).toEqual([1, 2, undefined]);
  });
});

describe("buildSeriesColors (ruleId)", () => {
  it("keys colours to the rule, not to which rules have traffic", () => {
    const both = buildSeriesColors(
      "ruleId",
      [{ group: "fr_a" }, { group: "fr_b" }],
      RULES,
    );
    const onlyB = buildSeriesColors("ruleId", [{ group: "fr_b" }], RULES);
    expect(onlyB.fr_b).toBe(both.fr_b);
    expect(both.fr_a).not.toBe(both.fr_b);
  });
});

describe("ruleReference", () => {
  it("names experiment refs by their experiment", () => {
    const map = new Map([
      [
        "exp_1",
        {
          id: "exp_1",
          name: "Checkout test",
          type: "standard",
        } as ExperimentInterfaceStringDates,
      ],
    ]);
    expect(
      ruleReference(
        rule({
          type: "experiment-ref",
          experimentId: "exp_1",
        } as Partial<FeatureRule>),
        map,
      ),
    ).toBe("Experiment: Checkout test");
  });

  it("falls back to the derived type name without a description", () => {
    expect(ruleReference(rule({ type: "rollout" }), noExperiments)).toBe(
      "Rollout",
    );
    expect(ruleReference(rule({ type: "force" }), noExperiments)).toBe(
      "Force Rule",
    );
  });
});

describe("buildRuleCellResolver", () => {
  const rules = [
    rule({ id: "fr_a", description: "Beta testers" }),
    rule({ id: "fr_mig__production", type: "rollout" }),
  ];
  const resolve = buildRuleCellResolver(rules, noExperiments);

  it("gives a rule the panel's label and the chart's colour", () => {
    const colors = buildSeriesColors("ruleId", [{ group: "fr_a" }], rules);
    expect(resolve("fr_a")).toEqual({
      kind: "rule",
      label: ruleReference(rules[0], noExperiments),
      color: colors.fr_a,
    });
  });

  it("matches a v1-migrated rule by stem, not as deleted", () => {
    expect(resolve("fr_mig")).toMatchObject({ kind: "rule", label: "Rollout" });
  });

  it("separates the default value, rule-less rows and deleted rules", () => {
    expect(resolve(DEFAULT_RULE_KEY)).toEqual({ kind: "default" });
    expect(resolve("")).toEqual({ kind: "none" });
    expect(resolve("fr_gone")).toEqual({ kind: "deleted" });
  });
});

describe("buildRuleTrafficSegments", () => {
  const rules = [
    rule({ id: "fr_a", description: "Beta testers" }),
    rule({ id: "fr_b__production", type: "rollout" }),
  ];
  const byRuleId: { v: Record<string, number> }[] = [
    { v: { fr_a: 50, fr_b: 30, $default: 10 } },
    { v: { fr_a: 5, fr_gone: 4 } },
  ];

  it("orders rules, removed, default, then served-without-a-rule", () => {
    const { segments, denominator, notBrokenDown } = buildRuleTrafficSegments({
      rules,
      experimentsMap: noExperiments,
      byRuleId,
      total: 120,
      includedEvaluations: 105,
      ruleNumberOffset: 1,
    });
    expect(segments.map((s) => [s.kind, s.count])).toEqual([
      ["rule", 55],
      ["rule", 30],
      ["removed", 4],
      ["default", 10],
      ["none", 6],
    ]);
    // The segments cover the denominator exactly.
    expect(segments.reduce((sum, s) => sum + s.count, 0)).toBe(denominator);
    expect(denominator).toBe(105);
    expect(notBrokenDown).toBe(15);
  });

  it("keeps the Diagnostics colour and the card's number for each rule", () => {
    const { segments } = buildRuleTrafficSegments({
      rules,
      experimentsMap: noExperiments,
      byRuleId,
      total: 99,
      ruleNumberOffset: 2,
    });
    const colors = buildSeriesColors("ruleId", [], rules);
    expect(segments[0]).toMatchObject({ index: 2, color: colors.fr_a });
    expect(segments[1]).toMatchObject({ index: 3, color: colors.fr_b });
  });

  it("without the disclosure, covers byRuleId alone", () => {
    const { segments, denominator, notBrokenDown } = buildRuleTrafficSegments({
      rules,
      experimentsMap: noExperiments,
      byRuleId,
      total: 99,
      ruleNumberOffset: 1,
    });
    expect(denominator).toBe(99);
    expect(segments[segments.length - 1]).toMatchObject({ count: 0 });
    expect(notBrokenDown).toBe(0);
  });

  it("lists every rule even with no traffic", () => {
    const { segments, denominator } = buildRuleTrafficSegments({
      rules,
      experimentsMap: noExperiments,
      byRuleId: [],
      total: 0,
      ruleNumberOffset: 1,
    });
    expect(segments.filter((s) => s.kind === "rule")).toHaveLength(2);
    expect(denominator).toBe(0);
  });
});
