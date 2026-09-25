import { FeatureRule } from "shared/types/feature";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import {
  buildBreakdownRows,
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
