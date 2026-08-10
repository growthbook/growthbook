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
    // A project/targeting move re-derives the destination's applicable envs
    // from the org's environment list, so the context must carry it.
    org: {
      id: "org_test",
      settings: { environments: ENVS.map((id) => ({ id })) },
    },
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
      // A metadata key that DOES reach the payload. `description` does not, and
      // pinning it here asserted the over-demand: editing a dev rule plus the
      // description refused a dev-limited publisher, while dropping the
      // description from the same request succeeded. The publish gate skips the
      // check entirely for inert metadata; both now read one shared rule.
      ["metadata", { metadata: { project: "prj_other" } }],
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

    it("does NOT widen for metadata that never reaches an SDK", async () => {
      const envs = await getMergeResultPublishEnvs({
        context: ctxWith(),
        feature: feat(),
        filledLiveRules: [],
        result: {
          metadata: { description: "x" },
          environmentsEnabled: { dev: true },
        } as unknown as MergeResultChanges,
        environmentIds: ENVS,
      });
      // Only the environment the change actually reaches. Widening to everything
      // served refused a dev-limited publisher for adding a description.
      expect(envs).toEqual(["dev"]);
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

    it("defaultValue + enabling a disabled env includes the env being enabled", async () => {
      // The publish-side hole revertFootprint closed on the revert side: the
      // global arm returned currently-enabled envs only, so pairing a global
      // edit with an ENABLE toggle dropped the enabled env from the footprint —
      // a staging-limited publisher could switch production on.
      const feature = feat({
        environmentSettings: {
          dev: { enabled: true, rules: [] },
          staging: { enabled: true, rules: [] },
          production: { enabled: false, rules: [] },
        },
      });
      const envs = await getMergeResultPublishEnvs({
        context: ctxWith(),
        feature,
        filledLiveRules: [],
        result: {
          defaultValue: "b",
          environmentsEnabled: { production: true },
        },
        environmentIds: ENVS,
      });
      expect(envs).toContain("production");
    });
  });

  describe("a project move widens to destination-applicable envs", () => {
    // The escalation the reviewer caught: `production` is project-scoped so it
    // is NOT applicable to the source project (excluded from environmentIds),
    // but the feature is already enabled there. A revision that ONLY relocates
    // the feature into the destination project activates production live. The
    // footprint must include production so publish authority over it is
    // demanded — computed from the DESTINATION project, not the pre-move one.
    function moveCtx(): ReqContext {
      return {
        org: {
          id: "org_test",
          settings: {
            environments: [
              { id: "dev" },
              { id: "staging" },
              // production only serves the destination project.
              { id: "production", projects: ["prj_dest"] },
            ],
          },
        },
        models: { holdout: { getById: jest.fn(async () => null) } },
      } as unknown as ReqContext;
    }

    it("demands authority over a destination-only env the move activates", async () => {
      const feature = feat({
        project: "prj_src",
        environmentSettings: {
          dev: { enabled: true, rules: [] },
          staging: { enabled: true, rules: [] },
          // Enabled but dormant: prj_src does not serve production.
          production: { enabled: true, rules: [] },
        },
      });
      // Pre-move applicable set excludes production (source can't serve it).
      const sourceApplicable = ["dev", "staging"];
      const envs = await getMergeResultPublishEnvs({
        context: moveCtx(),
        feature,
        filledLiveRules: [],
        result: { metadata: { project: "prj_dest" } },
        environmentIds: sourceApplicable,
      });
      expect(envs).toContain("production");
    });

    it("does not widen when nothing moves", async () => {
      // Same dormant-production feature, but a non-move change — production must
      // stay out of the footprint (the source still cannot serve it).
      const feature = feat({
        project: "prj_src",
        environmentSettings: {
          dev: { enabled: true, rules: [] },
          production: { enabled: true, rules: [] },
        },
      });
      const envs = await getMergeResultPublishEnvs({
        context: moveCtx(),
        feature,
        filledLiveRules: [],
        result: { defaultValue: "b" },
        environmentIds: ["dev"],
      });
      expect(envs).not.toContain("production");
    });
  });
});
