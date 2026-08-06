const experiments = new Map<string, { id: string; holdoutId?: string }>();
const added: { holdoutId: string; ids: string[] }[] = [];
const removed: { holdoutId: string; ids: string[] }[] = [];

jest.mock("back-end/src/models/ExperimentModel", () => ({
  getExperimentById: async (_ctx: unknown, id: string) =>
    experiments.get(id) ?? null,
  updateExperiment: async ({
    experiment,
    changes,
    guard,
  }: {
    experiment: { id: string; holdoutId?: string };
    changes: { holdoutId: string };
    guard?: { holdoutId: unknown };
  }) => {
    // The guard is a Mongo filter; model the two spellings the caller emits.
    if (guard) {
      const want = guard.holdoutId;
      const live = experiments.get(experiment.id)?.holdoutId ?? "";
      const matches =
        typeof want === "string" ? want === live : live === "" || live === null;
      if (!matches) throw new CasConflictError();
    }
    experiments.set(experiment.id, {
      ...experiment,
      holdoutId: changes.holdoutId,
    });
    return experiment;
  },
  addLinkedFeatureToExperiment: async () => undefined,
  clearPendingFeatureDraftsForRevision: async () => undefined,
  getExperimentMapForFeature: async () => new Map(),
  removeLinkedFeatureFromExperiment: async () => undefined,
}));

import type { ReqContext } from "back-end/types/organization";
import { CasConflictError } from "back-end/src/models/BaseModel";
import { reverseHoldoutExperimentLinkage } from "back-end/src/models/FeatureModel";

/**
 * The rewind's ownership rule.
 *
 * Converging to the pre-image unconditionally erased a teammate who had moved the
 * experiment while we were in flight. The scalar now skips an experiment a different
 * owner holds — and the MEMBERSHIP arrays have to follow the same decision, or
 * `linkedExperiments` and `holdoutId` end up disagreeing and a later publish reads the
 * live scalar as its expectation, matches, and quietly pulls the experiment out of
 * their holdout.
 */

function makeContext(): ReqContext {
  return {
    models: {
      holdout: {
        addExperimentsToHoldout: async (holdoutId: string, ids: string[]) => {
          added.push({ holdoutId, ids });
        },
        removeExperimentsFromHoldout: async (
          holdoutId: string,
          ids: string[],
        ) => {
          removed.push({ holdoutId, ids });
        },
      },
    },
  } as unknown as ReqContext;
}

beforeEach(() => {
  experiments.clear();
  added.length = 0;
  removed.length = 0;
});

describe("reverseHoldoutExperimentLinkage", () => {
  it("puts back an experiment it still owns, membership included", () => {
    experiments.set("exp_E", { id: "exp_E", holdoutId: "hld_1" });
    return reverseHoldoutExperimentLinkage(makeContext(), {
      holdoutId: "hld_1",
      toLink: ["exp_E"],
      toUnlink: [],
      prevExperimentHoldoutIds: { exp_E: "" },
    }).then(() => {
      expect(experiments.get("exp_E")?.holdoutId).toBe("");
      expect(removed).toEqual([{ holdoutId: "hld_1", ids: ["exp_E"] }]);
    });
  });

  // The teammate case: someone moved it after our forward pass.
  it("leaves an experiment a different owner now holds entirely alone", async () => {
    experiments.set("exp_E", { id: "exp_E", holdoutId: "hld_OTHER" });
    await reverseHoldoutExperimentLinkage(makeContext(), {
      holdoutId: "hld_1",
      toLink: ["exp_E"],
      toUnlink: [],
      prevExperimentHoldoutIds: { exp_E: "" },
    });
    // Scalar untouched...
    expect(experiments.get("exp_E")?.holdoutId).toBe("hld_OTHER");
    // ...and so is membership. Rewinding it here is what split the two apart.
    expect(removed).toEqual([{ holdoutId: "hld_1", ids: [] }]);
  });

  // Already at the pre-image: nothing to write, but it IS ours, so membership must
  // still be rewound. The second plan of a two-plan sequence always lands here,
  // because the first rewind put it there.
  it("rewinds membership for an experiment already at its pre-image", async () => {
    experiments.set("exp_E", { id: "exp_E", holdoutId: "" });
    await reverseHoldoutExperimentLinkage(makeContext(), {
      holdoutId: "hld_1",
      toLink: ["exp_E"],
      toUnlink: [],
      prevExperimentHoldoutIds: { exp_E: "" },
    });
    expect(removed).toEqual([{ holdoutId: "hld_1", ids: ["exp_E"] }]);
  });

  // The toUnlink half specifically: dropping only THIS filter left the suite green,
  // so the two directions need their own cases.
  it("leaves an unlinked experiment alone when a different owner holds it", async () => {
    experiments.set("exp_E", { id: "exp_E", holdoutId: "hld_OTHER" });
    await reverseHoldoutExperimentLinkage(makeContext(), {
      holdoutId: "hld_1",
      toLink: [],
      toUnlink: ["exp_E"],
      prevExperimentHoldoutIds: { exp_E: "hld_1" },
    });
    expect(experiments.get("exp_E")?.holdoutId).toBe("hld_OTHER");
    expect(added).toEqual([{ holdoutId: "hld_1", ids: [] }]);
  });

  it("re-adds an unlinked experiment it still owns", async () => {
    experiments.set("exp_E", { id: "exp_E", holdoutId: "" });
    await reverseHoldoutExperimentLinkage(makeContext(), {
      holdoutId: "hld_1",
      toLink: [],
      toUnlink: ["exp_E"],
      prevExperimentHoldoutIds: { exp_E: "hld_1" },
    });
    expect(experiments.get("exp_E")?.holdoutId).toBe("hld_1");
    expect(added).toEqual([{ holdoutId: "hld_1", ids: ["exp_E"] }]);
  });
});
