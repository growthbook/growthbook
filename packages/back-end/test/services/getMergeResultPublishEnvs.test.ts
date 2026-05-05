import { FeatureInterface, FeatureRule } from "shared/types/feature";
import { MergeResultChanges } from "shared/util";
import { HoldoutInterface } from "shared/validators";
import { getMergeResultPublishEnvs } from "back-end/src/services/features";
import { ReqContext } from "back-end/types/request";

const ENVS = ["dev", "staging", "production"];

function feat(overrides: Partial<FeatureInterface> = {}): FeatureInterface {
  return {
    id: "feat_x",
    organization: "org_test",
    owner: "tester",
    dateCreated: new Date(),
    dateUpdated: new Date(),
    valueType: "string",
    defaultValue: "a",
    version: 1,
    archived: false,
    description: "",
    tags: [],
    project: "",
    rules: [],
    environmentSettings: {
      dev: { enabled: true, rules: [] },
      staging: { enabled: true, rules: [] },
      production: { enabled: true, rules: [] },
    },
    ...overrides,
  } as FeatureInterface;
}

function holdout(
  id: string,
  enabledEnvs: string[],
  allEnvs: string[] = ENVS,
): HoldoutInterface {
  const environmentSettings: HoldoutInterface["environmentSettings"] = {};
  allEnvs.forEach((e) => {
    environmentSettings[e] = { enabled: enabledEnvs.includes(e), rules: [] };
  });
  return {
    id,
    organization: "org_test",
    name: id,
    projects: [],
    experimentId: "exp_h",
    linkedExperiments: {},
    linkedFeatures: {},
    environmentSettings,
    dateCreated: new Date(),
    dateUpdated: new Date(),
  } as HoldoutInterface;
}

function ctxWith(
  holdoutsById: Record<string, HoldoutInterface | null> = {},
): ReqContext {
  return {
    models: {
      holdout: {
        getById: jest.fn(async (id: string) => holdoutsById[id] ?? null),
      },
    },
  } as unknown as ReqContext;
}

const ruleA = (env: string, id = "r"): FeatureRule =>
  ({
    id: `${id}_${env}`,
    type: "force",
    enabled: true,
    value: "x",
    environments: [env],
  }) as unknown as FeatureRule;

describe("getMergeResultPublishEnvs", () => {
  describe("global field changes widen to all enabled envs", () => {
    it.each([
      ["defaultValue", { defaultValue: "b" }],
      ["prerequisites", { prerequisites: [] }],
      ["archived", { archived: true }],
      ["metadata", { metadata: { description: "x" } }],
    ])("%s", async (_label, change) => {
      const envs = await getMergeResultPublishEnvs({
        context: ctxWith(),
        feature: feat(),
        filledLiveRules: [],
        result: change as MergeResultChanges,
        environmentIds: ENVS,
      });
      expect(envs.sort()).toEqual([...ENVS].sort());
    });

    it("excludes envs disabled on the feature", async () => {
      const envs = await getMergeResultPublishEnvs({
        context: ctxWith(),
        feature: feat({
          environmentSettings: {
            dev: { enabled: false, rules: [] },
            staging: { enabled: true, rules: [] },
            production: { enabled: true, rules: [] },
          },
        }),
        filledLiveRules: [],
        result: { defaultValue: "b" },
        environmentIds: ENVS,
      });
      expect(envs.sort()).toEqual(["production", "staging"]);
    });
  });

  describe("env-scoped changes contribute only their envs", () => {
    it("rule diff in dev only", async () => {
      const live = [ruleA("dev"), ruleA("production")];
      const next = [ruleA("dev", "edited"), ruleA("production")];
      const envs = await getMergeResultPublishEnvs({
        context: ctxWith(),
        feature: feat(),
        filledLiveRules: live,
        result: { rules: next },
        environmentIds: ENVS,
      });
      expect(envs).toEqual(["dev"]);
    });

    it("toggle changes return only toggled envs", async () => {
      const envs = await getMergeResultPublishEnvs({
        context: ctxWith(),
        feature: feat(),
        filledLiveRules: [],
        result: { environmentsEnabled: { dev: false, staging: true } },
        environmentIds: ENVS,
      });
      expect(envs.sort()).toEqual(["dev", "staging"]);
    });

    it("union of rule + toggle envs", async () => {
      const live = [ruleA("production")];
      const next = [ruleA("production", "edited")];
      const envs = await getMergeResultPublishEnvs({
        context: ctxWith(),
        feature: feat(),
        filledLiveRules: live,
        result: {
          rules: next,
          environmentsEnabled: { dev: true },
        },
        environmentIds: ENVS,
      });
      expect(envs.sort()).toEqual(["dev", "production"]);
    });
  });

  describe("holdout assignment", () => {
    it("set new holdout adds the new holdout's enabled envs", async () => {
      const next = holdout("h_new", ["dev"]);
      const envs = await getMergeResultPublishEnvs({
        context: ctxWith({ h_new: next }),
        feature: feat({ holdout: undefined }),
        filledLiveRules: [],
        result: { holdout: { id: "h_new", value: "x" } },
        environmentIds: ENVS,
      });
      expect(envs).toEqual(["dev"]);
    });

    it("clear holdout adds the prior holdout's enabled envs", async () => {
      const prev = holdout("h_prev", ["staging"]);
      const envs = await getMergeResultPublishEnvs({
        context: ctxWith({ h_prev: prev }),
        feature: feat({ holdout: { id: "h_prev", value: "x" } }),
        filledLiveRules: [],
        result: { holdout: null },
        environmentIds: ENVS,
      });
      expect(envs).toEqual(["staging"]);
    });

    it("swap holdout unions both sides", async () => {
      const prev = holdout("h_prev", ["dev"]);
      const next = holdout("h_next", ["production"]);
      const envs = await getMergeResultPublishEnvs({
        context: ctxWith({ h_prev: prev, h_next: next }),
        feature: feat({ holdout: { id: "h_prev", value: "x" } }),
        filledLiveRules: [],
        result: { holdout: { id: "h_next", value: "y" } },
        environmentIds: ENVS,
      });
      expect(envs.sort()).toEqual(["dev", "production"]);
    });

    it("same-id holdout (re-set without change) skips DB lookup of prior", async () => {
      const next = holdout("h_same", ["dev"]);
      const getById = jest.fn(async (id: string) =>
        id === "h_same" ? next : null,
      );
      const context = {
        models: { holdout: { getById } },
      } as unknown as ReqContext;
      const envs = await getMergeResultPublishEnvs({
        context,
        feature: feat({ holdout: { id: "h_same", value: "x" } }),
        filledLiveRules: [],
        result: { holdout: { id: "h_same", value: "y" } },
        environmentIds: ENVS,
      });
      expect(envs).toEqual(["dev"]);
      expect(getById).toHaveBeenCalledTimes(1);
      expect(getById).toHaveBeenCalledWith("h_same");
    });

    it("filters holdout envs to org-allowed envs", async () => {
      const next = holdout("h_new", ["dev", "qa"], ["dev", "qa"]);
      const envs = await getMergeResultPublishEnvs({
        context: ctxWith({ h_new: next }),
        feature: feat({ holdout: undefined }),
        filledLiveRules: [],
        result: { holdout: { id: "h_new", value: "x" } },
        environmentIds: ENVS,
      });
      expect(envs).toEqual(["dev"]);
    });

    it("missing holdout in DB contributes no envs", async () => {
      const envs = await getMergeResultPublishEnvs({
        context: ctxWith({}),
        feature: feat({ holdout: undefined }),
        filledLiveRules: [],
        result: {
          holdout: { id: "h_missing", value: "x" },
          environmentsEnabled: { staging: true },
        },
        environmentIds: ENVS,
      });
      expect(envs).toEqual(["staging"]);
    });

    it("holdout untouched (undefined) does not query DB", async () => {
      const getById = jest.fn();
      const context = {
        models: { holdout: { getById } },
      } as unknown as ReqContext;
      await getMergeResultPublishEnvs({
        context,
        feature: feat({ holdout: { id: "h_prev", value: "x" } }),
        filledLiveRules: [],
        result: { environmentsEnabled: { dev: true } },
        environmentIds: ENVS,
      });
      expect(getById).not.toHaveBeenCalled();
    });
  });

  describe("fallback when nothing globally significant changed", () => {
    it("empty result falls back to all enabled envs", async () => {
      const envs = await getMergeResultPublishEnvs({
        context: ctxWith(),
        feature: feat(),
        filledLiveRules: [],
        result: {},
        environmentIds: ENVS,
      });
      expect(envs.sort()).toEqual([...ENVS].sort());
    });

    it("rules-touched but identical falls back to all enabled envs", async () => {
      const live = [ruleA("dev")];
      const envs = await getMergeResultPublishEnvs({
        context: ctxWith(),
        feature: feat(),
        filledLiveRules: live,
        result: { rules: [...live] },
        environmentIds: ENVS,
      });
      expect(envs.sort()).toEqual([...ENVS].sort());
    });
  });

  describe("global + env-scoped changes still widen", () => {
    it("defaultValue + per-env rule still returns all enabled envs", async () => {
      const live = [ruleA("dev")];
      const next = [ruleA("dev", "edited")];
      const envs = await getMergeResultPublishEnvs({
        context: ctxWith(),
        feature: feat(),
        filledLiveRules: live,
        result: { defaultValue: "b", rules: next },
        environmentIds: ENVS,
      });
      expect(envs.sort()).toEqual([...ENVS].sort());
    });
  });
});
