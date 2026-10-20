import { FeatureInterface } from "shared/types/feature";
import {
  getTempRolloutCandidateFeatureIds,
  selectServedTempRolloutExperimentIds,
} from "back-end/src/services/tempRollouts";

type Exp = Parameters<typeof selectServedTempRolloutExperimentIds>[0][number];

function exp(overrides: Partial<Exp> = {}): Exp {
  return {
    id: "exp_1",
    type: "standard",
    status: "stopped",
    archived: false,
    excludeFromPayload: false,
    releasedVariationId: "v1",
    hasVisualChangesets: false,
    hasURLRedirects: false,
    linkedFeatures: ["flag"],
    phases: [{ dateStarted: new Date("2026-01-01") }],
    ...overrides,
  } as Exp;
}

function feature(
  id: string,
  envs: Record<
    string,
    { enabled: boolean; rules: { experimentId: string; enabled?: boolean }[] }
  >,
  archived = false,
): FeatureInterface {
  const environmentSettings: Record<string, { enabled: boolean }> = {};
  const rules: unknown[] = [];
  for (const [env, cfg] of Object.entries(envs)) {
    environmentSettings[env] = { enabled: cfg.enabled };
    cfg.rules.forEach((r, i) => {
      rules.push({
        type: "experiment-ref",
        id: `rule_${env}_${i}`,
        description: "",
        enabled: r.enabled ?? true,
        experimentId: r.experimentId,
        variations: [],
        environments: [env],
      });
    });
  }
  return {
    id,
    archived,
    environmentSettings,
    rules,
  } as unknown as FeatureInterface;
}

const byId = (...features: FeatureInterface[]) =>
  new Map(features.map((f) => [f.id, f]));

describe("selectServedTempRolloutExperimentIds", () => {
  it("serves when a linked feature has an enabled rule in an enabled env", () => {
    const f = feature("flag", {
      production: { enabled: true, rules: [{ experimentId: "exp_1" }] },
    });
    expect(selectServedTempRolloutExperimentIds([exp()], byId(f))).toEqual([
      "exp_1",
    ]);
  });

  it("does not serve when the only rule is disabled", () => {
    const f = feature("flag", {
      production: {
        enabled: true,
        rules: [{ experimentId: "exp_1", enabled: false }],
      },
    });
    expect(selectServedTempRolloutExperimentIds([exp()], byId(f))).toEqual([]);
  });

  it("does not serve when the only environment is disabled", () => {
    const f = feature("flag", {
      production: { enabled: false, rules: [{ experimentId: "exp_1" }] },
    });
    expect(selectServedTempRolloutExperimentIds([exp()], byId(f))).toEqual([]);
  });

  it("does not serve when the linked feature has no rule for it", () => {
    const f = feature("flag", {
      production: { enabled: true, rules: [{ experimentId: "exp_other" }] },
    });
    expect(selectServedTempRolloutExperimentIds([exp()], byId(f))).toEqual([]);
  });

  it("does not serve when the linked feature is archived", () => {
    const f = feature(
      "flag",
      { production: { enabled: true, rules: [{ experimentId: "exp_1" }] } },
      true,
    );
    expect(selectServedTempRolloutExperimentIds([exp()], byId(f))).toEqual([]);
  });

  it("does not serve when the linked features no longer exist", () => {
    expect(selectServedTempRolloutExperimentIds([exp()], byId())).toEqual([]);
  });

  it("serves visual and redirect experiments without consulting features", () => {
    expect(
      selectServedTempRolloutExperimentIds(
        [
          exp({ id: "visual", hasVisualChangesets: true, linkedFeatures: [] }),
          exp({ id: "redirect", hasURLRedirects: true, linkedFeatures: [] }),
        ],
        byId(),
      ),
    ).toEqual(["visual", "redirect"]);
  });

  it("skips running, archived, excluded, unreleased, and holdout experiments", () => {
    const f = feature("flag", {
      production: { enabled: true, rules: [{ experimentId: "exp_1" }] },
    });
    const cases = [
      exp({ status: "running" }),
      exp({ archived: true }),
      exp({ excludeFromPayload: true }),
      exp({ releasedVariationId: undefined }),
      exp({ type: "holdout" }),
    ];
    expect(selectServedTempRolloutExperimentIds(cases, byId(f))).toEqual([]);
  });
});

describe("getTempRolloutCandidateFeatureIds", () => {
  it("collects linked features of feature-only candidates, deduplicated", () => {
    expect(
      getTempRolloutCandidateFeatureIds([
        exp({ id: "a", linkedFeatures: ["f1", "f2"] }),
        exp({ id: "b", linkedFeatures: ["f2"] }),
        exp({ id: "c", hasVisualChangesets: true, linkedFeatures: ["f3"] }),
        exp({ id: "d", status: "running", linkedFeatures: ["f4"] }),
      ]),
    ).toEqual(["f1", "f2"]);
  });
});
