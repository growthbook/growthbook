import { holdoutLinkageWrites } from "back-end/src/models/FeatureModel";
import type { HoldoutExperimentLinkagePlan } from "back-end/src/models/FeatureModel";

/**
 * The compare-and-swap expectation for a holdout-linkage write.
 *
 * A holdout CHANGE emits two plans — leave H2, then join H1 — and
 * `planHoldoutExperimentLinkage` computes both before either applies, so both carry
 * the same pre-image. An experiment named by both is written twice: the leave sets it
 * to "", and the join then expects the shared pre-image "hld_H2" that its own sibling
 * has just replaced. Guarding on the pre-image alone made that revert fail on every
 * retry, forever — and in bulk it rolled the whole batch back on a race that never
 * happened.
 */

const plan = (
  holdoutId: string,
  {
    toLink = [],
    toUnlink = [],
    prev = {},
  }: {
    toLink?: string[];
    toUnlink?: string[];
    prev?: Record<string, string>;
  },
): HoldoutExperimentLinkagePlan => ({
  holdoutId,
  toLink,
  toUnlink,
  prevExperimentHoldoutIds: prev,
});

describe("holdoutLinkageWrites", () => {
  it("expects the pre-image when nothing in this sequence has written yet", () => {
    const { targets, expectedPrior } = holdoutLinkageWrites(
      plan("hld_1", { toLink: ["exp_E"], prev: { exp_E: "" } }),
      {},
    );
    expect(targets).toEqual({ exp_E: "hld_1" });
    expect(expectedPrior).toEqual({ exp_E: "" });
  });

  it("unlinking targets the empty value", () => {
    const { targets } = holdoutLinkageWrites(
      plan("hld_2", { toUnlink: ["exp_E"], prev: { exp_E: "hld_2" } }),
      {},
    );
    expect(targets).toEqual({ exp_E: "" });
  });

  // The regression, as the sequence actually runs.
  it("the second plan expects what the first one wrote, not the shared pre-image", () => {
    const chain: Record<string, string> = {};
    const shared = { exp_E: "hld_H2" };

    const leaving = holdoutLinkageWrites(
      plan("hld_H2", { toUnlink: ["exp_E"], prev: shared }),
      chain,
    );
    expect(leaving.expectedPrior).toEqual({ exp_E: "hld_H2" });
    Object.assign(chain, leaving.targets);

    const joining = holdoutLinkageWrites(
      plan("hld_H1", { toLink: ["exp_E"], prev: shared }),
      chain,
    );
    // NOT "hld_H2": the leave already moved it to "". Expecting the pre-image here is
    // a guaranteed conflict with our own earlier step.
    expect(joining.expectedPrior).toEqual({ exp_E: "" });
    expect(joining.targets).toEqual({ exp_E: "hld_H1" });
  });

  // An experiment only the second plan touches must still use the pre-image — the
  // chain is not a blanket override.
  it("leaves an untouched experiment on its pre-image within the same sequence", () => {
    const chain: Record<string, string> = { exp_E: "" };
    const { expectedPrior } = holdoutLinkageWrites(
      plan("hld_H1", {
        toLink: ["exp_E", "exp_OTHER"],
        prev: { exp_E: "hld_H2", exp_OTHER: "hld_H3" },
      }),
      chain,
    );
    expect(expectedPrior).toEqual({ exp_E: "", exp_OTHER: "hld_H3" });
  });

  // A pre-image with no entry for an id means "was empty" — the field has no default,
  // so absent is the normal state.
  it("treats a missing pre-image entry as the empty value", () => {
    const { expectedPrior } = holdoutLinkageWrites(
      plan("hld_1", { toLink: ["exp_NEW"], prev: {} }),
      {},
    );
    expect(expectedPrior).toEqual({ exp_NEW: "" });
  });

  it("works with no chain at all, for a single-plan sequence", () => {
    const { expectedPrior } = holdoutLinkageWrites(
      plan("hld_1", { toLink: ["exp_E"], prev: { exp_E: "hld_0" } }),
    );
    expect(expectedPrior).toEqual({ exp_E: "hld_0" });
  });
});
