import type { FeatureRule } from "shared/types/feature";
import type { RulePatchInput } from "shared/validators";
import { applyPatch } from "back-end/src/api/features/putFeatureRevisionRule";
import { addIdsToFlatRules } from "back-end/src/services/features";

// `applyPatch` re-infers force-vs-rollout from the effective coverage, so a
// coverage patch converts a force rule into a seedless rollout — which the
// handler must stamp, or it loses independent bucketing.
describe("applyPatch — force/rollout seed stamping", () => {
  const force = {
    id: "fr_1",
    type: "force",
    description: "",
    value: "true",
    enabled: true,
  } as unknown as FeatureRule;

  const patch = (p: Record<string, unknown>) => p as unknown as RulePatchInput;
  const stamp = (r: unknown) => addIdsToFlatRules([r as FeatureRule], "feat_1");
  const seedOf = (r: unknown) => (r as { seed?: string }).seed;

  it("converts force → rollout with no seed, then stamps the rule id", () => {
    const converted = applyPatch(
      force,
      patch({ coverage: 0.5, hashAttribute: "id" }),
    );
    expect(converted.type).toBe("rollout");
    expect(seedOf(converted)).toBeUndefined();

    stamp(converted);
    expect(seedOf(converted)).toBe("fr_1");
    expect(seedOf(converted)).not.toBe("feat_1");
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
    stamp(updated);
    expect(seedOf(updated)).toBe("feat_1");
  });

  it("honors an explicit seed in the patch", () => {
    const converted = applyPatch(
      force,
      patch({ coverage: 0.5, hashAttribute: "id", seed: "custom" }),
    );
    stamp(converted);
    expect(seedOf(converted)).toBe("custom");
  });
});
