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
 *
 * Ownership has two conditions, and the value test is only the second. The first is
 * `writtenExperimentIds`: what the forward pass actually WROTE. State alone cannot
 * tell our own earlier attempt from a concurrent publish that reached the target
 * first — both leave the experiment sitting on the value we wanted — so a rewind
 * that judges by value alone undoes the concurrent publish's successful linkage.
 * Every plan below declares what its forward pass wrote, because that is now part of
 * the plan's contract.
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
      writtenExperimentIds: new Set(["exp_E"]),
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
      writtenExperimentIds: new Set(["exp_E"]),
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
      writtenExperimentIds: new Set(["exp_E"]),
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
      writtenExperimentIds: new Set(["exp_E"]),
    });
    expect(experiments.get("exp_E")?.holdoutId).toBe("hld_OTHER");
    expect(added).toEqual([{ holdoutId: "hld_1", ids: [] }]);
  });

  it("leaves alone an experiment it found already at the target", async () => {
    // The theft. A concurrent publish linked exp_E to hld_1 before our forward pass
    // reached it, so our pass wrote NOTHING — but the experiment sits on exactly the
    // value we wanted, which is indistinguishable from our own write. Judging by
    // value, this rewind unlinks their experiment and strips their membership.
    experiments.set("exp_E", { id: "exp_E", holdoutId: "hld_1" });
    await reverseHoldoutExperimentLinkage(makeContext(), {
      holdoutId: "hld_1",
      toLink: ["exp_E"],
      toUnlink: [],
      prevExperimentHoldoutIds: { exp_E: "" },
      // The forward pass found it at target and wrote nothing.
      writtenExperimentIds: new Set(),
    });
    expect(experiments.get("exp_E")?.holdoutId).toBe("hld_1");
    expect(removed).toEqual([{ holdoutId: "hld_1", ids: [] }]);
  });

  it("undoes only the experiments its forward pass reached", async () => {
    // A pass that threw partway wrote some and not others. The ones it never reached
    // need nothing undone — and must not be undone, since anything sitting on the
    // target value there was put there by someone else.
    experiments.set("exp_WROTE", { id: "exp_WROTE", holdoutId: "hld_1" });
    experiments.set("exp_NEVER", { id: "exp_NEVER", holdoutId: "hld_1" });
    await reverseHoldoutExperimentLinkage(makeContext(), {
      holdoutId: "hld_1",
      toLink: ["exp_WROTE", "exp_NEVER"],
      toUnlink: [],
      prevExperimentHoldoutIds: { exp_WROTE: "", exp_NEVER: "" },
      writtenExperimentIds: new Set(["exp_WROTE"]),
    });
    expect(experiments.get("exp_WROTE")?.holdoutId).toBe("");
    expect(experiments.get("exp_NEVER")?.holdoutId).toBe("hld_1");
    expect(removed).toEqual([{ holdoutId: "hld_1", ids: ["exp_WROTE"] }]);
  });

  it("re-adds an unlinked experiment it still owns", async () => {
    experiments.set("exp_E", { id: "exp_E", holdoutId: "" });
    await reverseHoldoutExperimentLinkage(makeContext(), {
      holdoutId: "hld_1",
      toLink: [],
      toUnlink: ["exp_E"],
      prevExperimentHoldoutIds: { exp_E: "hld_1" },
      writtenExperimentIds: new Set(["exp_E"]),
    });
    expect(experiments.get("exp_E")?.holdoutId).toBe("hld_1");
    expect(added).toEqual([{ holdoutId: "hld_1", ids: ["exp_E"] }]);
  });
});
