import type { FeatureRule } from "shared/types/feature";
import type { RulePatchFields } from "shared/validators";
import { putFeatureRevisionRuleValidator } from "shared/validators";
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

  const patch = (p: Record<string, unknown>) => p as unknown as RulePatchFields;
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

// The PUT body is a union of per-type patch shapes, so the schema enforces field
// applicability. Targeting is absent from the experiment-ref member.
// Repointing leaves the previous experiment's arm ids in place, so the handler
// must validate an experimentId-only patch too.
describe("applyPatch — experiment-ref repointing", () => {
  const rule = {
    id: "fr_1",
    type: "experiment-ref",
    description: "",
    enabled: true,
    experimentId: "exp_old",
    variations: [
      { variationId: "v0", value: "false" },
      { variationId: "v1", value: "true" },
    ],
  } as unknown as FeatureRule;

  it("keeps the previous experiment's variations when only experimentId is patched", () => {
    const patched = applyPatch(rule, {
      experimentId: "exp_new",
    } as unknown as RulePatchFields);

    expect(patched).toMatchObject({
      experimentId: "exp_new",
      variations: [
        { variationId: "v0", value: "false" },
        { variationId: "v1", value: "true" },
      ],
    });
  });
});

describe("rule patch schema — per-type shapes", () => {
  const body = (rule: Record<string, unknown>) =>
    putFeatureRevisionRuleValidator.bodySchema.safeParse({
      environment: "production",
      rule,
    });

  it.each([
    ["condition", { condition: '{"country": "US"}' }],
    ["savedGroups", { savedGroups: [{ match: "all", ids: ["grp_1"] }] }],
    ["prerequisites", { prerequisites: [{ id: "parent", condition: "{}" }] }],
  ])("rejects %s on an experiment-ref patch", (_field, targeting) => {
    expect(
      body({ type: "experiment-ref", experimentId: "exp_1", ...targeting })
        .success,
    ).toBe(false);
  });

  it("accepts an experiment-ref patch of its own fields", () => {
    expect(
      body({
        type: "experiment-ref",
        experimentId: "exp_1",
        variations: [{ variationId: "v0", value: "false" }],
      }).success,
    ).toBe(true);
  });

  it("still accepts targeting on force/rollout and safe-rollout patches", () => {
    expect(
      body({ type: "force", condition: '{"country": "US"}' }).success,
    ).toBe(true);
    expect(
      body({ type: "safe-rollout", condition: '{"country": "US"}' }).success,
    ).toBe(true);
  });

  it("rejects fields belonging to another rule type", () => {
    expect(body({ type: "force", variations: [] }).success).toBe(false);
    expect(body({ type: "experiment-ref", coverage: 0.5 }).success).toBe(false);
  });

  it("accepts a typeless patch, resolving by the fields it carries", () => {
    expect(body({ enabled: false }).success).toBe(true);
    expect(body({ coverage: 0.5 }).success).toBe(true);
    expect(body({ variations: [] }).success).toBe(true);
  });
});
