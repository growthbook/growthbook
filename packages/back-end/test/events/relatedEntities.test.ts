import cloneDeep from "lodash/cloneDeep";
import { FeatureInterface, FeatureRule } from "shared/types/feature";
import {
  getChangedExperimentEntities,
  getDependentEntities,
  getExperimentFlagEntities,
  payloadKeysReach,
} from "back-end/src/events/relatedEntities";

const envs = ["dev", "prod"];

const experimentRule = (overrides: Partial<FeatureRule> = {}): FeatureRule =>
  ({
    id: "fr_exp",
    type: "experiment-ref",
    description: "",
    condition: "",
    enabled: true,
    experimentId: "exp_1",
    variations: [],
    allEnvironments: true,
    ...overrides,
  }) as FeatureRule;

const forceRule = (overrides: Partial<FeatureRule> = {}): FeatureRule =>
  ({
    id: "fr_force",
    type: "force",
    description: "",
    condition: "",
    enabled: true,
    value: "true",
    allEnvironments: true,
    ...overrides,
  }) as FeatureRule;

const feature: FeatureInterface = {
  id: "checkout",
  organization: "org",
  owner: "",
  dateCreated: new Date("2026-01-01"),
  dateUpdated: new Date("2026-01-01"),
  valueType: "boolean",
  defaultValue: "false",
  archived: false,
  description: "",
  version: 1,
  environmentSettings: {
    dev: { enabled: true, rules: [] },
    prod: { enabled: true, rules: [] },
  },
  rules: [forceRule(), experimentRule()],
};

const change = (mutate: (f: FeatureInterface) => void) => {
  const updated = cloneDeep(feature);
  mutate(updated);
  return updated;
};

describe("getChangedExperimentEntities", () => {
  it("lists nothing when only an unrelated rule changed", () => {
    expect(
      getChangedExperimentEntities(
        feature,
        change((f) => (f.rules = [forceRule({ value: "false" }), f.rules![1]])),
        envs,
        envs,
      ),
    ).toEqual([]);
  });

  it("lists the experiment when its own rule changed", () => {
    expect(
      getChangedExperimentEntities(
        feature,
        change(
          (f) => (f.rules = [f.rules![0], experimentRule({ condition: "{}" })]),
        ),
        envs,
        envs,
      ),
    ).toEqual([{ type: "experiment", id: "exp_1", environments: envs }]);
  });

  it("lists the experiment in the environment a toggle switched it off", () => {
    expect(
      getChangedExperimentEntities(
        feature,
        change((f) => (f.environmentSettings.prod.enabled = false)),
        ["prod"],
        envs,
      ),
    ).toEqual([{ type: "experiment", id: "exp_1", environments: ["prod"] }]);
  });

  it("lists nothing for a rule inserted above the experiment", () => {
    expect(
      getChangedExperimentEntities(
        feature,
        change(
          (f) => (f.rules = [forceRule({ id: "fr_new" }), ...(f.rules ?? [])]),
        ),
        envs,
        envs,
      ),
    ).toEqual([]);
  });

  it("lists a disabled experiment rule only when it switches on", () => {
    const off = change((f) => (f.rules = [experimentRule({ enabled: false })]));
    expect(
      getChangedExperimentEntities(
        off,
        change(
          (f) =>
            (f.rules = [experimentRule({ enabled: false, condition: "{}" })]),
        ),
        envs,
        envs,
      ),
    ).toEqual([]);
    expect(
      getChangedExperimentEntities(
        off,
        change((f) => (f.rules = [experimentRule()])),
        envs,
        envs,
      ),
    ).toEqual([{ type: "experiment", id: "exp_1", environments: envs }]);
  });
});

describe("getExperimentFlagEntities", () => {
  it("lists linked flags with the environments where they run it", () => {
    const scoped = change((f) => {
      f.rules = [
        experimentRule({ allEnvironments: false, environments: ["prod"] }),
      ];
    });
    const disabled = change((f) => {
      f.id = "pricing";
      f.environmentSettings.dev.enabled = false;
      f.environmentSettings.prod.enabled = false;
    });
    expect(
      getExperimentFlagEntities("exp_1", [scoped, disabled], envs),
    ).toEqual([{ type: "feature", id: "checkout", environments: ["prod"] }]);
  });
});

describe("getDependentEntities", () => {
  it("lists dependent flags and experiments with their live environments", () => {
    const devOnly = change((f) => {
      f.id = "banner";
      f.environmentSettings.prod.enabled = false;
    });
    expect(
      getDependentEntities(
        {
          features: [devOnly],
          experiments: [{ id: "exp_1", linkedFeatures: ["checkout"] }],
        },
        envs,
        new Map([["checkout", feature]]),
      ),
    ).toEqual([
      { type: "feature", id: "banner", environments: ["dev"] },
      { type: "experiment", id: "exp_1", environments: envs },
    ]);
  });
});

describe("payloadKeysReach", () => {
  it("lists each environment the payload keys touch once, in org order", () => {
    expect(
      payloadKeysReach(
        [
          { environment: "prod", project: "" },
          { environment: "prod", project: "prj_1" },
        ],
        [],
        envs,
      ),
    ).toEqual({ environments: ["prod"], relatedEntities: [] });
  });
});
