import type { FeatureInterface, FeatureRule } from "shared/types/feature";
import type { ReqContext } from "back-end/types/organization";
import {
  ApiRuleV2Input,
  assertValidRuleProjectIds,
  composeConfigBacking,
  extractRevisionMetadata,
  mapV2ApiRuleToFeatureRule,
  resolveScopeFromInput,
} from "back-end/src/api/features/v2Shared";

// ---------------------------------------------------------------------------
// Pure-function unit tests for the v2 API mapping/extraction helpers.
//
// `mapV2ApiRuleToFeatureRule` is the chokepoint between the v2 REST input
// shape and the on-disk `FeatureRule` shape. Three things to lock down:
//   1. Each rule type (force / rollout / experiment-ref / safe-rollout)
//      lands in the correct internal shape.
//   2. Scope inference — `allEnvironments` vs `environments[]` — defaults
//      cleanly when only one is supplied.
//   3. Safe-rollout is preserve-only: it requires a matching
//      `safeRolloutId` on `existingFeature`, otherwise the bulk path throws.
//      New safe-rollouts must go through the per-rule add endpoint.
// ---------------------------------------------------------------------------

describe("resolveScopeFromInput", () => {
  it("allEnvironments:true drops environments[]", () => {
    expect(resolveScopeFromInput(true, ["dev", "prod"])).toEqual({
      allEnvironments: true,
      environments: undefined,
    });
  });

  it("allEnvironments:false with environments[] keeps the explicit list", () => {
    expect(resolveScopeFromInput(false, ["dev"])).toEqual({
      allEnvironments: false,
      environments: ["dev"],
    });
  });

  it("allEnvironments:false with no environments[] defaults to []", () => {
    expect(resolveScopeFromInput(false, undefined)).toEqual({
      allEnvironments: false,
      environments: [],
    });
  });

  it("undefined allEnvironments + environments[] infers allEnvironments:false", () => {
    expect(resolveScopeFromInput(undefined, ["dev"])).toEqual({
      allEnvironments: false,
      environments: ["dev"],
    });
  });

  it("undefined + undefined defaults to allEnvironments:true", () => {
    expect(resolveScopeFromInput(undefined, undefined)).toEqual({
      allEnvironments: true,
      environments: undefined,
    });
  });
});

describe("composeConfigBacking", () => {
  it("composes an object patch onto the config backing", () => {
    expect(
      composeConfigBacking("pricing", '{"discount":5}', "Rule value"),
    ).toBe('{"$extends":["@config:pricing"],"discount":5}');
  });

  it("keeps a pure backing ref for an empty/whitespace patch", () => {
    expect(composeConfigBacking("pricing", "", "Rule value")).toBe(
      '{"$extends":["@config:pricing"]}',
    );
    expect(composeConfigBacking("pricing", "   ", "Rule value")).toBe(
      '{"$extends":["@config:pricing"]}',
    );
    expect(composeConfigBacking("pricing", undefined, "Rule value")).toBe(
      '{"$extends":["@config:pricing"]}',
    );
  });

  it("rejects a scalar or array value when a config is supplied (would silently drop the backing)", () => {
    expect(() => composeConfigBacking("pricing", "42", "Rule value")).toThrow(
      /must be a JSON object when backed by a config/,
    );
    expect(() =>
      composeConfigBacking("pricing", '"hello"', "Variation value"),
    ).toThrow(/Variation value must be a JSON object/);
    expect(() =>
      composeConfigBacking("pricing", "[1,2]", "Rule value"),
    ).toThrow(/must be a JSON object when backed by a config/);
    expect(() => composeConfigBacking("pricing", "true", "Rule value")).toThrow(
      /must be a JSON object when backed by a config/,
    );
  });

  it("leaves a scalar value untouched when no config is supplied (detach)", () => {
    expect(composeConfigBacking(null, "42", "Rule value")).toBe("42");
  });
});

describe("mapV2ApiRuleToFeatureRule", () => {
  it("rejects a config-backed variation whose value is a scalar", () => {
    expect(() =>
      mapV2ApiRuleToFeatureRule({
        type: "experiment-ref",
        experimentId: "exp_1",
        variations: [{ variationId: "0", value: "42", config: "pricing" }],
      } as ApiRuleV2Input),
    ).toThrow(/Variation value must be a JSON object/);
  });

  it("composes a config-backed force value from an object patch", () => {
    const out = mapV2ApiRuleToFeatureRule({
      type: "force",
      value: '{"discount":5}',
      config: "pricing",
    } as ApiRuleV2Input);
    expect(out.value).toBe('{"$extends":["@config:pricing"],"discount":5}');
  });

  describe("force rule", () => {
    it("maps minimal force input with default scope (allEnvironments:true)", () => {
      const out = mapV2ApiRuleToFeatureRule({
        type: "force",
        value: "true",
      } as ApiRuleV2Input);
      expect(out).toMatchObject({
        type: "force",
        value: "true",
        allEnvironments: true,
        environments: undefined,
        enabled: true,
        description: "",
        condition: "",
        id: "",
      });
    });

    it("maps savedGroupTargeting from input matchType+savedGroups to internal match+ids", () => {
      const out = mapV2ApiRuleToFeatureRule({
        type: "force",
        value: "true",
        savedGroupTargeting: [{ matchType: "any", savedGroups: ["g1", "g2"] }],
      } as ApiRuleV2Input);
      expect(out.savedGroups).toEqual([{ match: "any", ids: ["g1", "g2"] }]);
    });

    it("infers allEnvironments:false when only environments[] is provided", () => {
      const out = mapV2ApiRuleToFeatureRule({
        type: "force",
        value: "v",
        environments: ["dev"],
      } as ApiRuleV2Input);
      expect(out.allEnvironments).toBe(false);
      expect(out.environments).toEqual(["dev"]);
    });
  });

  describe("rollout rule", () => {
    it("maps coverage and hashAttribute, defaulting coverage to 1 if absent", () => {
      const out = mapV2ApiRuleToFeatureRule({
        type: "rollout",
        value: "v",
        coverage: 0.5,
        hashAttribute: "userId",
      } as ApiRuleV2Input);
      expect(out).toMatchObject({
        type: "rollout",
        value: "v",
        coverage: 0.5,
        hashAttribute: "userId",
      });
    });
  });

  describe("experiment-ref rule", () => {
    it("maps variations and experimentId", () => {
      const out = mapV2ApiRuleToFeatureRule({
        type: "experiment-ref",
        experimentId: "exp_1",
        variations: [
          { variationId: "v0", value: "a" },
          { variationId: "v1", value: "b" },
        ],
      } as ApiRuleV2Input);
      expect(out).toMatchObject({
        type: "experiment-ref",
        experimentId: "exp_1",
        variations: [
          { variationId: "v0", value: "a" },
          { variationId: "v1", value: "b" },
        ],
      });
    });
  });

  // -------------------------------------------------------------------------
  // safe-rollout: preserve-only behavior. New safe-rollouts can't be created
  // through the bulk PUT path because they require SafeRollout entity
  // creation + datasource validation + compensation orchestration. The
  // mapper instead expects the caller to round-trip an existing rule and
  // verifies that `safeRolloutId` matches an existing safe-rollout on
  // `existingFeature`.
  // -------------------------------------------------------------------------
  describe("safe-rollout (preserve-only)", () => {
    const existingSafeRolloutRule: FeatureRule = {
      id: "fr_sr_1",
      type: "safe-rollout",
      description: "old description",
      enabled: true,
      condition: "",
      controlValue: "false",
      variationValue: "true",
      hashAttribute: "userId",
      trackingKey: "tk_existing",
      seed: "seed_existing",
      safeRolloutId: "sr_abc",
      status: "running",
      allEnvironments: false,
      environments: ["production"],
    } as unknown as FeatureRule;

    const featureWithSafeRollout: FeatureInterface = {
      rules: [existingSafeRolloutRule],
    } as unknown as FeatureInterface;

    it("preserves an existing safe-rollout rule when safeRolloutId matches", () => {
      const out = mapV2ApiRuleToFeatureRule(
        {
          type: "safe-rollout",
          id: "fr_sr_1",
          controlValue: "false",
          variationValue: "true",
          hashAttribute: "userId",
          safeRolloutId: "sr_abc",
        } as ApiRuleV2Input,
        featureWithSafeRollout,
      );
      expect(out).toMatchObject({
        type: "safe-rollout",
        safeRolloutId: "sr_abc",
        controlValue: "false",
        variationValue: "true",
        hashAttribute: "userId",
        // Falls back to existing rule's tracking/seed/status when not in payload.
        trackingKey: "tk_existing",
        seed: "seed_existing",
        status: "running",
      });
    });

    it("accepts overrides for trackingKey/seed/status when explicitly supplied", () => {
      const out = mapV2ApiRuleToFeatureRule(
        {
          type: "safe-rollout",
          controlValue: "false",
          variationValue: "true",
          hashAttribute: "userId",
          safeRolloutId: "sr_abc",
          trackingKey: "tk_new",
          seed: "seed_new",
          status: "stopped",
        } as ApiRuleV2Input,
        featureWithSafeRollout,
      );
      expect(out).toMatchObject({
        trackingKey: "tk_new",
        seed: "seed_new",
        status: "stopped",
      });
    });

    it("throws when safeRolloutId does not match any existing safe-rollout on the feature", () => {
      expect(() =>
        mapV2ApiRuleToFeatureRule(
          {
            type: "safe-rollout",
            controlValue: "false",
            variationValue: "true",
            hashAttribute: "userId",
            safeRolloutId: "sr_unknown",
          } as ApiRuleV2Input,
          featureWithSafeRollout,
        ),
      ).toThrow(/does not match any existing safe-rollout/);
    });

    it("throws when no existingFeature is supplied (e.g. POST /v2/features create path)", () => {
      // postFeatureV2 doesn't pass `existingFeature` because brand-new
      // features can't reference an existing safe-rollout. Any safe-rollout
      // rule in a create payload must therefore throw.
      expect(() =>
        mapV2ApiRuleToFeatureRule({
          type: "safe-rollout",
          controlValue: "false",
          variationValue: "true",
          hashAttribute: "userId",
          safeRolloutId: "sr_abc",
        } as ApiRuleV2Input),
      ).toThrow(/does not match any existing safe-rollout/);
    });

    it("throws when the matching rule on the feature is not a safe-rollout", () => {
      // Defends against safeRolloutId collision with a rule that happens to
      // share an id but is a different type (e.g. force rule with the same
      // id stem from a previous v1→v2 migration).
      const featureWithForceRule: FeatureInterface = {
        rules: [
          {
            id: "fr_force",
            type: "force",
            description: "",
            enabled: true,
            value: "true",
            allEnvironments: true,
          } as unknown as FeatureRule,
        ],
      } as unknown as FeatureInterface;

      expect(() =>
        mapV2ApiRuleToFeatureRule(
          {
            type: "safe-rollout",
            controlValue: "false",
            variationValue: "true",
            hashAttribute: "userId",
            safeRolloutId: "fr_force",
          } as ApiRuleV2Input,
          featureWithForceRule,
        ),
      ).toThrow(/does not match any existing safe-rollout/);
    });
  });
});

// ---------------------------------------------------------------------------
// extractRevisionMetadata — pure split of metadata-like fields out of an
// updates payload. Refactored from a mutating helper; tests guard against
// regression to the in-place mutation pattern.
// ---------------------------------------------------------------------------

describe("extractRevisionMetadata", () => {
  it("splits owner/description/project/tags/customFields/jsonSchema into metadata", () => {
    const updates: Partial<FeatureInterface> = {
      owner: "alice",
      description: "d",
      project: "p1",
      tags: ["t1"],
      customFields: { c: "v" },
      jsonSchema: {
        schemaType: "schema",
        schema: "{}",
        date: new Date(),
        enabled: true,
        simple: { type: "object", fields: [] },
      },
      defaultValue: "true",
      archived: false,
    };

    const { metadata, remaining } = extractRevisionMetadata(updates);

    expect(metadata).toMatchObject({
      owner: "alice",
      description: "d",
      project: "p1",
      tags: ["t1"],
      customFields: { c: "v" },
    });
    expect(metadata.jsonSchema).toBeDefined();
    expect(remaining).toEqual({
      defaultValue: "true",
      archived: false,
    });
  });

  it("does not mutate the input object (regression: prior version mutated in place)", () => {
    const updates: Partial<FeatureInterface> = {
      owner: "alice",
      defaultValue: "true",
    };
    const before = JSON.stringify(updates);
    extractRevisionMetadata(updates);
    expect(JSON.stringify(updates)).toBe(before);
  });

  it("ignores undefined-valued metadata keys", () => {
    const updates: Partial<FeatureInterface> = {
      owner: undefined,
      description: "d",
    };
    const { metadata, remaining } = extractRevisionMetadata(updates);
    expect(metadata).toEqual({ description: "d" });
    expect("owner" in metadata).toBe(false);
    // Undefined-valued keys flow through unchanged on `remaining`.
    expect(remaining).toEqual({ owner: undefined });
  });

  it("returns empty metadata + identical-content remaining when no metadata fields are present", () => {
    const updates: Partial<FeatureInterface> = {
      defaultValue: "true",
      archived: true,
    };
    const { metadata, remaining } = extractRevisionMetadata(updates);
    expect(metadata).toEqual({});
    expect(remaining).toEqual(updates);
    // Returned `remaining` is a fresh object, not the same reference.
    expect(remaining).not.toBe(updates);
  });
});

describe("assertValidRuleProjectIds", () => {
  const context = {
    getProjects: async () => [{ id: "p1" }, { id: "p2" }],
  } as unknown as ReqContext;
  const rule = (projects?: string[]) =>
    ({ id: "r", type: "force", projects }) as unknown as FeatureRule;

  it("resolves when every rule project exists", async () => {
    await expect(
      assertValidRuleProjectIds([rule(["p1"]), rule(["p2"])], context),
    ).resolves.toBeUndefined();
  });

  it("resolves for rules with no project scope", async () => {
    await expect(
      assertValidRuleProjectIds([rule(), rule([])], context),
    ).resolves.toBeUndefined();
  });

  it("throws when a rule references a non-existent project", async () => {
    await expect(
      assertValidRuleProjectIds([rule(["p1"]), rule(["ghost"])], context),
    ).rejects.toThrow(/rule project ids.*ghost/);
  });
});
