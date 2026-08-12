import {
  featurePublishFootprint,
  holdoutEnvsForChange,
  revertFootprint,
  servingEnvironments,
  HOLDOUT_ENVS_UNRESOLVED,
} from "shared/permissions";
import type { MergeResultChanges } from "shared/util";
import type { FeatureRule } from "shared/types/feature";

/**
 * The footprint is the input that kept being wrong. Both halves of the authority
 * check were correct in isolation — the atom and the environment list — but the
 * endpoints and the controls computed the list differently, and every difference
 * ran the same direction: the control offered a landing the endpoint refused.
 *
 * These cases pin the composition rules, not the plumbing: what counts as
 * reaching an environment, and what an unknown widens to.
 */

const ENVS = ["dev", "staging", "production"];

const feature = {
  environmentSettings: {
    dev: { enabled: true },
    staging: { enabled: true },
    production: { enabled: false },
  },
};

function rule(id: string, environment?: string): FeatureRule {
  return {
    id,
    type: "force",
    description: "",
    value: "x",
    enabled: true,
    ...(environment ? { environments: [environment] } : {}),
  } as unknown as FeatureRule;
}

function footprint(
  changes: MergeResultChanges,
  { liveRules = [] as FeatureRule[], holdoutEnvs = [] as string[] } = {},
) {
  return featurePublishFootprint({
    feature,
    liveRules,
    changes,
    environmentIds: ENVS,
    holdoutEnvs,
  }).sort();
}

describe("servingEnvironments", () => {
  it("is the enabled environments, restricted to those allowed", () => {
    expect(servingEnvironments(feature, ENVS)).toEqual(["dev", "staging"]);
    expect(servingEnvironments(feature, ["dev"])).toEqual(["dev"]);
  });

  it("treats a flag with no settings as serving nowhere", () => {
    expect(servingEnvironments({}, ENVS)).toEqual([]);
  });
});

describe("featurePublishFootprint", () => {
  it("is the serving environments when nothing environment-scoped changed", () => {
    expect(footprint({})).toEqual(["dev", "staging"]);
  });

  // The gap that made the control fail open: a toggle IS the change, and the
  // environment it enables is not yet serving.
  it("includes an environment the draft enables, even one not yet serving", () => {
    expect(footprint({ environmentsEnabled: { production: true } })).toEqual([
      "production",
    ]);
  });

  it("includes an environment the draft DISABLES", () => {
    expect(footprint({ environmentsEnabled: { dev: false } })).toEqual(["dev"]);
  });

  it("counts only the environments whose rules actually differ", () => {
    const liveRules = [rule("r1", "dev"), rule("r2", "staging")];
    const changes: MergeResultChanges = {
      rules: [rule("r1", "dev"), rule("r2-changed", "staging")],
    };
    expect(footprint(changes, { liveRules })).toEqual(["staging"]);
  });

  it("ignores a rules array that is unchanged", () => {
    const liveRules = [rule("r1", "dev")];
    expect(footprint({ rules: [rule("r1", "dev")] }, { liveRules })).toEqual([
      "dev",
      "staging",
    ]);
  });

  // A global field is felt everywhere, so the footprint is everything the change
  // REACHES — including an environment this same draft switches on. Returning
  // only the already-serving set let a draft that enabled production and edited
  // the default value land without production authority.
  describe.each([
    ["defaultValue", { defaultValue: "new" }],
    ["prerequisites", { prerequisites: [{ id: "f", condition: "{}" }] }],
    ["archived", { archived: true }],
    ["metadata", { metadata: { project: "prj_other" } }],
  ])("a change touching %s", (_label, change) => {
    it("reaches every serving environment", () => {
      expect(footprint(change as MergeResultChanges)).toEqual([
        "dev",
        "staging",
      ]);
    });

    it("also reaches one the same draft enables", () => {
      expect(
        footprint({
          ...(change as MergeResultChanges),
          environmentsEnabled: { production: true },
        }),
      ).toEqual(["dev", "production", "staging"]);
    });
  });

  it("includes the environments a holdout move affects", () => {
    expect(
      footprint(
        { holdout: { id: "ho_1", value: "v" } },
        {
          holdoutEnvs: ["production"],
        },
      ),
    ).toEqual(["production"]);
  });

  // A holdout may be enabled where the flag is not, so no narrower set is
  // guaranteed to contain what the server computes. Widening is the only safe
  // answer for a caller that can't resolve it.
  it("widens to every environment when a holdout cannot be resolved", () => {
    expect(
      featurePublishFootprint({
        feature,
        liveRules: [],
        changes: { holdout: { id: "ho_1", value: "v" } },
        environmentIds: ENVS,
        holdoutEnvs: HOLDOUT_ENVS_UNRESOLVED,
      }).sort(),
    ).toEqual(["dev", "production", "staging"]);
  });
});

describe("holdoutEnvsForChange", () => {
  const holdouts = new Map([
    ["ho_old", { environmentSettings: { dev: { enabled: true } } }],
    ["ho_new", { environmentSettings: { production: { enabled: true } } }],
  ]);
  const resolve = (id: string) => holdouts.get(id);

  it("says nothing when the change doesn't touch holdout", () => {
    expect(
      holdoutEnvsForChange({
        currentHoldoutId: "ho_old",
        newHoldout: undefined,
        environmentIds: ENVS,
        resolve,
      }),
    ).toEqual({ envs: [], unresolved: [] });
  });

  it("unions the one being left with the one being joined", () => {
    const { envs } = holdoutEnvsForChange({
      currentHoldoutId: "ho_old",
      newHoldout: { id: "ho_new" },
      environmentIds: ENVS,
      resolve,
    });
    expect(envs.sort()).toEqual(["dev", "production"]);
  });

  it("counts the current holdout only when it is actually being left", () => {
    const { envs } = holdoutEnvsForChange({
      currentHoldoutId: "ho_new",
      newHoldout: { id: "ho_new" },
      environmentIds: ENVS,
      resolve,
    });
    expect(envs).toEqual(["production"]);
  });

  it("counts the one being left when holdout is cleared", () => {
    const { envs } = holdoutEnvsForChange({
      currentHoldoutId: "ho_old",
      newHoldout: null,
      environmentIds: ENVS,
      resolve,
    });
    expect(envs).toEqual(["dev"]);
  });

  // Reported, not dropped: the server means "the holdout is gone" and the front
  // end means "not loaded yet", and those call for opposite treatment.
  it("reports ids it could not resolve instead of silently skipping them", () => {
    expect(
      holdoutEnvsForChange({
        currentHoldoutId: "ho_missing",
        newHoldout: { id: "ho_new" },
        environmentIds: ENVS,
        resolve,
      }),
    ).toEqual({ envs: ["production"], unresolved: ["ho_missing"] });
  });

  it("restricts a holdout's environments to those allowed", () => {
    const { envs } = holdoutEnvsForChange({
      currentHoldoutId: undefined,
      newHoldout: { id: "ho_new" },
      environmentIds: ["dev", "staging"],
      resolve,
    });
    expect(envs).toEqual([]);
  });
});

describe("revertFootprint", () => {
  it("is the serving environments when the target enables nothing new", () => {
    expect(
      revertFootprint({
        feature,
        targetRevision: {},
        environmentIds: ENVS,
      }).sort(),
    ).toEqual(["dev", "staging"]);
  });

  // Each half of this union was missed on its own: an environment re-enabled with
  // identical rules appears in the enable half only, and one whose rules change
  // without a toggle appears in the changed half only.
  it("adds an environment the restored revision switches back ON", () => {
    expect(
      revertFootprint({
        feature,
        targetRevision: { environmentsEnabled: { production: true } },
        environmentIds: ENVS,
      }).sort(),
    ).toEqual(["dev", "production", "staging"]);
  });

  it("adds an environment whose rules the revert would change", () => {
    expect(
      revertFootprint({
        feature,
        targetRevision: {},
        environmentIds: ENVS,
        changedEnvs: ["production"],
      }).sort(),
    ).toEqual(["dev", "production", "staging"]);
  });

  it("ignores an environment the target DISABLES, and any outside the allowed set", () => {
    expect(
      revertFootprint({
        feature,
        targetRevision: {
          environmentsEnabled: { production: false, retired: true },
        },
        environmentIds: ENVS,
        changedEnvs: ["retired"],
      }).sort(),
    ).toEqual(["dev", "staging"]);
  });
});
