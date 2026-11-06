import { ExperimentInterface, ExperimentPhase } from "shared/types/experiment";
import { ExperimentQaOverrideInterface } from "shared/types/experiment-qa-override";
import { FeatureDefinitionRule } from "shared/types/sdk";
import { SavedGroupPayloadStrategy } from "shared/sdk-versioning/saved-groups/types";
import { qaOverrideAppliesToConnection } from "shared/util";
import {
  applyQaOverrideToRule,
  qaOverrideCondition,
  qaOverrideWeights,
} from "../../src/util/features";

const experiment = {
  trackingKey: "checkout",
  variations: [
    { id: "v0", key: "0", name: "Control" },
    { id: "v1", key: "1", name: "One-page" },
    { id: "v2", key: "2", name: "Apple Pay" },
  ],
  phases: [{ variationWeights: [0.34, 0.33, 0.33] }],
} as unknown as ExperimentInterface;

const phase = {
  variationWeights: [0.34, 0.33, 0.33],
  coverage: 0.5,
  condition: '{"country":"US"}',
} as unknown as ExperimentPhase;

// Inline strategy: saved groups become `$inGroup` references, nothing is rewritten.
const savedGroupStrategy = {
  format: "referencesV1",
  groupMap: new Map([
    ["grp_qa", { type: "list", attributeKey: "id", hasValues: true }],
  ]),
  createCondition: ({ groupId, include }) =>
    include ? { id: { $inGroup: groupId } } : { id: { $notInGroup: groupId } },
  createSavedGroupsOperatorHandler: () => () => undefined,
  finalizeCondition: () => undefined,
} as unknown as SavedGroupPayloadStrategy;

const forcedOverride: ExperimentQaOverrideInterface = {
  id: "eqo_1",
  organization: "org",
  dateCreated: new Date(),
  dateUpdated: new Date(),
  experiment: "exp_1",
  environment: "dev",
  order: 0,
  filters: {},
  assignment: { type: "forced", variationId: "v1" },
  createdBy: "u_1",
};
const randomOverride: ExperimentQaOverrideInterface = {
  ...forcedOverride,
  id: "eqo_2",
  assignment: { type: "random" },
};

describe("qaOverrideWeights", () => {
  it("forces one variation with one-hot weights", () => {
    expect(qaOverrideWeights(forcedOverride, experiment, phase)).toEqual([
      0, 1, 0,
    ]);
  });

  it("keeps the phase weights for random assignment", () => {
    expect(qaOverrideWeights(randomOverride, experiment, phase)).toEqual([
      0.34, 0.33, 0.33,
    ]);
  });

  it("falls back to the phase weights when the variation is missing", () => {
    expect(
      qaOverrideWeights(
        {
          ...forcedOverride,
          assignment: { type: "forced", variationId: "nope" },
        },
        experiment,
        phase,
      ),
    ).toEqual([0.34, 0.33, 0.33]);
  });
});

describe("qaOverrideCondition", () => {
  const experimentCondition = { country: "US" };

  it("ignores the experiment condition when forcing a variation", () => {
    expect(
      qaOverrideCondition({
        override: forcedOverride,
        experimentCondition,
        savedGroupStrategy,
      }),
    ).toBeUndefined();
  });

  it("keeps the experiment condition for random assignment", () => {
    expect(
      qaOverrideCondition({
        override: randomOverride,
        experimentCondition,
        savedGroupStrategy,
      }),
    ).toEqual(experimentCondition);
  });

  it("compiles the filters and ANDs them with the experiment condition only for random assignment", () => {
    const filters = {
      condition: '{"email":{"$in":["a@x.com"]}}',
      savedGroups: [{ match: "all" as const, ids: ["grp_qa"] }],
    };
    const compiled = {
      $and: [{ email: { $in: ["a@x.com"] } }, { id: { $inGroup: "grp_qa" } }],
    };
    expect(
      qaOverrideCondition({
        override: { ...forcedOverride, filters },
        experimentCondition,
        savedGroupStrategy,
      }),
    ).toEqual(compiled);
    expect(
      qaOverrideCondition({
        override: { ...randomOverride, filters },
        experimentCondition,
        savedGroupStrategy,
      }),
    ).toEqual({ $and: [experimentCondition, compiled] });
  });
});

describe("applyQaOverrideToRule", () => {
  const buildRule = (): FeatureDefinitionRule => ({
    key: "checkout",
    coverage: 0.5,
    weights: [0.34, 0.33, 0.33],
    variations: ["a", "b", "c"],
    condition: { country: "US" },
    parentConditions: [{ id: "parent", condition: { value: true } }],
    namespace: ["ns", 0, 0.5],
    seed: "phase-seed",
  });

  it("forcing a variation strips targeting, coverage, prerequisites and namespace", () => {
    const rule = applyQaOverrideToRule(
      buildRule(),
      experiment,
      phase,
      forcedOverride,
      savedGroupStrategy,
    );
    expect(rule.key).toBe("checkout__qa");
    expect(rule.weights).toEqual([0, 1, 0]);
    expect(rule.coverage).toBe(1);
    expect(rule.disableStickyBucketing).toBe(true);
    expect(rule.condition).toBeUndefined();
    expect(rule.parentConditions).toBeUndefined();
    expect(rule.namespace).toBeUndefined();
    expect(rule.variations).toEqual(["a", "b", "c"]);
  });

  it("random assignment keeps the experiment as configured", () => {
    const rule = applyQaOverrideToRule(
      buildRule(),
      experiment,
      phase,
      randomOverride,
      savedGroupStrategy,
    );
    expect(rule.key).toBe("checkout__qa");
    expect(rule.weights).toEqual([0.34, 0.33, 0.33]);
    expect(rule.coverage).toBe(0.5);
    expect(rule.condition).toEqual({ country: "US" });
    expect(rule.parentConditions).toHaveLength(1);
    expect(rule.namespace).toEqual(["ns", 0, 0.5]);
  });
});

describe("qaOverrideAppliesToConnection", () => {
  const connection = { id: "sdk_1", environment: "dev", projects: ["p1"] };

  it("requires the same environment", () => {
    expect(qaOverrideAppliesToConnection(forcedOverride, connection)).toBe(
      true,
    );
    expect(
      qaOverrideAppliesToConnection(forcedOverride, {
        ...connection,
        environment: "staging",
      }),
    ).toBe(false);
  });

  it("honors the connection filter", () => {
    const override = {
      ...forcedOverride,
      filters: { sdkConnections: ["sdk_2"] },
    };
    expect(qaOverrideAppliesToConnection(override, connection)).toBe(false);
    expect(
      qaOverrideAppliesToConnection(override, { ...connection, id: "sdk_2" }),
    ).toBe(true);
  });

  it("honors the project filter, treating an unscoped connection as matching", () => {
    const override = { ...forcedOverride, filters: { projects: ["p2"] } };
    expect(qaOverrideAppliesToConnection(override, connection)).toBe(false);
    expect(
      qaOverrideAppliesToConnection(override, { ...connection, projects: [] }),
    ).toBe(true);
    expect(
      qaOverrideAppliesToConnection(override, {
        ...connection,
        projects: ["p1", "p2"],
      }),
    ).toBe(true);
  });
});
