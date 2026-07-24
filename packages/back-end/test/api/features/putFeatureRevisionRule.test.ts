import type { FeatureRule } from "shared/types/feature";
import type { RulePatchInput } from "shared/validators";
import { applyPatch } from "back-end/src/api/features/putFeatureRevisionRule";
import { addIdsToFlatRules } from "back-end/src/services/features";

// `applyPatch` re-infers force-vs-rollout from the effective coverage, so a
// coverage patch can turn a force rule into a rollout. That converted rule has
// no seed, so the handler stamps it — otherwise it would persist seedless, get
// pinned to the feature id on read, and overlap any sibling rollout in hash
// space instead of bucketing independently.
describe("applyPatch — force/rollout seed stamping", () => {
  const force = {
    id: "fr_1",
    type: "force",
    description: "",
    value: "true",
    enabled: true,
  } as unknown as FeatureRule;

  const patch = (p: Record<string, unknown>) => p as unknown as RulePatchInput;

  it("converts force → rollout with no seed, then stamps the rule id", () => {
    const converted = applyPatch(
      force,
      patch({ coverage: 0.5, hashAttribute: "id" }),
    );
    expect(converted.type).toBe("rollout");
    expect((converted as { seed?: string }).seed).toBeUndefined();

    addIdsToFlatRules([converted as FeatureRule], "feat_1");
    expect((converted as { seed?: string }).seed).toBe("fr_1");
    expect((converted as { seed?: string }).seed).not.toBe("feat_1");
  });

  it("leaves a rollout's existing (read-time-pinned) seed untouched", () => {
    const legacy = {
      ...force,
      type: "rollout",
      coverage: 0.5,
      hashAttribute: "id",
      seed: "feat_1", // pinned to the feature id on read
    } as unknown as FeatureRule;

    const updated = applyPatch(legacy, patch({ coverage: 0.25 }));
    addIdsToFlatRules([updated as FeatureRule], "feat_1");
    expect((updated as { seed?: string }).seed).toBe("feat_1");
  });

  it("honors an explicit seed in the patch", () => {
    const converted = applyPatch(
      force,
      patch({ coverage: 0.5, hashAttribute: "id", seed: "custom" }),
    );
    addIdsToFlatRules([converted as FeatureRule], "feat_1");
    expect((converted as { seed?: string }).seed).toBe("custom");
  });
});
