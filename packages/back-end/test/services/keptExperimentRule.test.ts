import cloneDeep from "lodash/cloneDeep";
import {
  ExperimentInterface,
  ExperimentRefRule,
  FeatureInterface,
  FeatureRule,
} from "shared/validators";
import { FeatureDefinitionRule } from "shared/types/sdk";
import { keptExperimentRule } from "back-end/src/services/experiment-feature";
import { getFeatureDefinition } from "back-end/src/util/features";

const experiment: ExperimentInterface = {
  id: "exp_1",
  organization: "org_1",
  name: "Exp",
  owner: "",
  trackingKey: "exp-key",
  hashAttribute: "user_id",
  fallbackAttribute: "device_id",
  hashVersion: 2,
  status: "stopped",
  releasedVariationId: "v1",
  excludeFromPayload: false,
  archived: false,
  autoAssign: false,
  implementation: "code",
  autoSnapshots: false,
  datasource: "",
  exposureQueryId: "",
  metrics: [],
  previewURL: "",
  targetURLRegex: "",
  tags: [],
  dateCreated: new Date(),
  dateUpdated: new Date(),
  linkedFeatures: ["feature"],
  variations: [
    { id: "v0", key: "0", name: "Control", screenshots: [] },
    { id: "v1", key: "1", name: "Variation", screenshots: [] },
  ],
  phases: [
    {
      name: "Phase",
      dateStarted: new Date(),
      reason: "",
      condition: JSON.stringify({ country: "US" }),
      coverage: 0.4,
      variationWeights: [0.5, 0.5],
      namespace: { enabled: false, name: "", range: [0, 1] },
      seed: "phase-seed",
    },
  ],
} as ExperimentInterface;

const refRule: ExperimentRefRule = {
  id: "fr_ref",
  type: "experiment-ref",
  description: "",
  enabled: true,
  experimentId: "exp_1",
  variations: [
    { variationId: "v0", value: "false" },
    { variationId: "v1", value: "true" },
  ],
};

function payloadRule(
  rule: FeatureRule,
  exp: ExperimentInterface,
): FeatureDefinitionRule {
  const feature: FeatureInterface = {
    id: "feature",
    organization: "org_1",
    owner: "",
    description: "",
    valueType: "boolean",
    defaultValue: "false",
    archived: false,
    version: 1,
    dateCreated: new Date(),
    dateUpdated: new Date(),
    environmentSettings: { production: { enabled: true, rules: [rule] } },
  };
  const def = getFeatureDefinition({
    feature,
    environment: "production",
    groupMap: new Map(),
    experimentMap: new Map([[exp.id, exp]]),
    safeRolloutMap: new Map(),
    capabilities: ["looseUnmarshalling", "stickyBucketing"],
  });
  return def!.rules![0];
}

// What decides who the SDK serves a forced value to.
const audience = (r: FeatureDefinitionRule) => ({
  force: r.force,
  condition: r.condition,
  coverage: r.coverage,
  hashAttribute: r.hashAttribute,
  // The SDK reads it only while the rule keeps sticky bucketing on.
  fallbackAttribute: r.disableStickyBucketing ? undefined : r.fallbackAttribute,
  seed: r.seed || "feature",
  hashVersion: r.hashVersion || 1,
});

describe("keptExperimentRule", () => {
  it.each<[string, (e: ExperimentInterface) => void]>([
    ["a partial rollout with a fallback attribute", () => {}],
    [
      "sticky bucketing off",
      (e) => {
        e.disableStickyBucketing = true;
      },
    ],
    [
      "no phase seed",
      (e) => {
        e.phases[0].seed = "";
      },
    ],
    [
      "no hash version",
      (e) => {
        delete e.hashVersion;
      },
    ],
    [
      "full coverage",
      (e) => {
        e.phases[0].coverage = 1;
        delete e.fallbackAttribute;
      },
    ],
  ])("serves the temporary rollout's users: %s", (_, change) => {
    const exp = cloneDeep(experiment);
    change(exp);
    const kept = keptExperimentRule(exp, refRule, "feature");
    expect(kept).not.toBeNull();
    const temporary = audience(payloadRule(refRule, exp));
    const permanent = audience(payloadRule(kept!, exp));
    // A 100% release serves everyone, not only users with the attribute.
    if (exp.phases[0].coverage === 1) {
      expect(kept!.type).toBe("force");
      expect(permanent.force).toBe(temporary.force);
      return;
    }
    expect(permanent).toEqual(temporary);
  });

  it("drops a rule whose released arm has no value", () => {
    expect(
      keptExperimentRule(
        experiment,
        { ...refRule, variations: [{ variationId: "v0", value: "false" }] },
        "feature",
      ),
    ).toBeNull();
  });
});
