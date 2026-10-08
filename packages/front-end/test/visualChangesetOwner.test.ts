import { describe, it, expect, vi } from "vitest";
import {
  contextualBanditVisualChangesetOwner,
  experimentVisualChangesetOwner,
} from "@/components/Experiment/visualChangesetOwner";

const experimentVariation = (id: string) => ({
  id,
  name: id,
  key: id,
  screenshots: [],
});

const experimentPhase = (ids: string[], weights: number[]) => ({
  dateStarted: "2026-01-01T00:00:00.000Z",
  name: "Main",
  reason: "",
  coverage: 1,
  condition: "",
  variationWeights: weights,
  variations: ids.map((id) => ({ id, status: "active" as const })),
});

const draftExperiment = {
  id: "exp_1",
  trackingKey: "exp-1",
  status: "draft" as const,
  variations: ["v0", "v1", "v2"].map(experimentVariation),
  phases: [experimentPhase(["v0", "v1", "v2"], [0.5, 0.25, 0.25])],
};

const cbVariation = (id: string, status?: "active" | "pending") => ({
  id,
  key: id,
  name: id,
  ...(status ? { status } : {}),
});

const draftCb = {
  id: "cb_1",
  trackingKey: "cb-1",
  status: "draft" as const,
  archived: false,
  variations: [
    cbVariation("a0"),
    cbVariation("a1", "active"),
    cbVariation("a2", "pending"),
    cbVariation("a3"),
  ],
  variationWeights: [
    { variationId: "a0", weight: 0.4 },
    { variationId: "a1", weight: 0.35 },
    { variationId: "a3", weight: 0.25 },
  ],
};

describe("experimentVisualChangesetOwner", () => {
  it("maps latest-phase variations with their weights and preview index", () => {
    const owner = experimentVisualChangesetOwner(draftExperiment);
    expect(owner.noun).toBe("experiment");
    expect(owner.trackingKey).toBe("exp-1");
    expect(owner.variations).toEqual([
      { id: "v0", name: "v0", weight: 0.5, previewIndex: 0 },
      { id: "v1", name: "v1", weight: 0.25, previewIndex: 1 },
      { id: "v2", name: "v2", weight: 0.25, previewIndex: 2 },
    ]);
  });

  it("only allows editing and deleting variations on drafts", () => {
    const draft = experimentVisualChangesetOwner(draftExperiment);
    expect(draft.canEditChanges).toBe(true);
    expect(draft.canDeleteVariation(0)).toBe(false);
    expect(draft.canDeleteVariation(1)).toBe(true);

    const running = experimentVisualChangesetOwner({
      ...draftExperiment,
      status: "running",
    });
    expect(running.canEditChanges).toBe(false);
    expect(running.canDeleteVariation(1)).toBe(false);
  });

  it("never lets the last two variations be deleted", () => {
    const owner = experimentVisualChangesetOwner({
      ...draftExperiment,
      variations: ["v0", "v1"].map(experimentVariation),
      phases: [experimentPhase(["v0", "v1"], [0.5, 0.5])],
    });
    expect(owner.canDeleteVariation(1)).toBe(false);
  });

  it("passes the delete handler through", async () => {
    const deleteVariation = vi.fn(async () => {});
    const owner = experimentVisualChangesetOwner(
      draftExperiment,
      deleteVariation,
    );
    await owner.deleteVariation?.("v1");
    expect(deleteVariation).toHaveBeenCalledWith("v1");
  });
});

describe("contextualBanditVisualChangesetOwner", () => {
  it("uses live bandit weights and numbers previews by active arm only", () => {
    const owner = contextualBanditVisualChangesetOwner(draftCb);
    expect(owner.noun).toBe("contextual bandit");
    expect(owner.trackingKey).toBe("cb-1");
    expect(owner.variations).toEqual([
      { id: "a0", name: "a0", weight: 0.4, previewIndex: 0 },
      { id: "a1", name: "a1", weight: 0.35, previewIndex: 1 },
      { id: "a2", name: "a2", weight: 0, previewIndex: undefined },
      { id: "a3", name: "a3", weight: 0.25, previewIndex: 2 },
    ]);
  });

  it("falls back to zero weight when the bandit has no weights yet", () => {
    const owner = contextualBanditVisualChangesetOwner({
      ...draftCb,
      variationWeights: undefined,
    });
    expect(owner.variations.map((v) => v.weight)).toEqual([0, 0, 0, 0]);
  });

  it("allows editing changes while the bandit is not stopped or archived", () => {
    expect(contextualBanditVisualChangesetOwner(draftCb).canEditChanges).toBe(
      true,
    );
    expect(
      contextualBanditVisualChangesetOwner({ ...draftCb, status: "running" })
        .canEditChanges,
    ).toBe(true);
    expect(
      contextualBanditVisualChangesetOwner({ ...draftCb, status: "stopped" })
        .canEditChanges,
    ).toBe(false);
    expect(
      contextualBanditVisualChangesetOwner({ ...draftCb, archived: true })
        .canEditChanges,
    ).toBe(false);
  });

  it("only allows deleting non-control arms on drafts with more than two arms", () => {
    const draft = contextualBanditVisualChangesetOwner(draftCb);
    expect(draft.canDeleteVariation(0)).toBe(false);
    expect(draft.canDeleteVariation(2)).toBe(true);

    const running = contextualBanditVisualChangesetOwner({
      ...draftCb,
      status: "running",
    });
    expect(running.canDeleteVariation(2)).toBe(false);

    const twoArms = contextualBanditVisualChangesetOwner({
      ...draftCb,
      variations: [cbVariation("a0"), cbVariation("a1")],
    });
    expect(twoArms.canDeleteVariation(1)).toBe(false);
  });
});
