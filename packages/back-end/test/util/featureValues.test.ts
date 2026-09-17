import { FeatureInterface, FeatureRule } from "shared/types/feature";
import { ReqContext } from "back-end/types/request";
import {
  FeatureValueError,
  getFeatureValuesForDriftRepair,
  normalizeFeatureJSONValues,
} from "back-end/src/util/featureValues";
import {
  assertFeatureValuesValid,
  assertFeatureValuesValidForPublish,
} from "back-end/src/services/features";
import { getJSONValue } from "back-end/src/util/features";

const jsonFeature: Pick<FeatureInterface, "valueType" | "jsonSchema"> = {
  valueType: "json",
  jsonSchema: {
    schemaType: "schema",
    schema: '{"type":"object","required":["requiredKey"]}',
    simple: { type: "object", fields: [] },
    date: new Date(),
    enabled: true,
  },
};
const baseRule = { id: "rule", description: "", allEnvironments: true };
const ruleCases: [string, (value: string) => FeatureRule][] = [
  ["force", (value) => ({ ...baseRule, type: "force", value, sparse: true })],
  [
    "rollout",
    (value) => ({
      ...baseRule,
      type: "rollout",
      value,
      coverage: 0.5,
      hashAttribute: "id",
    }),
  ],
  [
    "experiment",
    (value) => ({
      ...baseRule,
      type: "experiment",
      trackingKey: "exp",
      hashAttribute: "id",
      values: [
        { value: "{}", weight: 0.5 },
        { value, weight: 0.5, name: "Treatment" },
      ],
    }),
  ],
  [
    "experiment-ref",
    (value) => ({
      ...baseRule,
      type: "experiment-ref",
      experimentId: "exp",
      variations: [
        { variationId: "0", value: "{}" },
        { variationId: "1", value },
      ],
    }),
  ],
  [
    "contextual-bandit-ref",
    (value) => ({
      ...baseRule,
      type: "contextual-bandit-ref",
      contextualBanditId: "bandit",
      variations: [
        { variationId: "0", value: "{}" },
        { variationId: "1", value },
      ],
    }),
  ],
  ...(["controlValue", "variationValue"] as const).map(
    (field): [string, (value: string) => FeatureRule] => [
      `safe-rollout ${field}`,
      (value) => ({
        ...baseRule,
        type: "safe-rollout",
        controlValue: "{}",
        variationValue: "{}",
        [field]: value,
        safeRolloutId: "rollout",
        status: "running",
        hashAttribute: "id",
        seed: "seed",
        trackingKey: "exp",
      }),
    ],
  ),
];

describe("normalizeFeatureJSONValues", () => {
  const typeOnly = { valueType: jsonFeature.valueType };

  it("repairs the stored default so the SDK parser serves its value", () => {
    const input = { defaultValue: "{ answer: 42 }", rules: [], version: 2 };
    expect(getJSONValue("json", input.defaultValue)).toBeNull();
    const result = normalizeFeatureJSONValues(typeOnly, input);
    expect(getJSONValue("json", result.defaultValue)).toEqual({ answer: 42 });
    expect(result.version).toBe(2);
    expect(input.defaultValue).toBe("{ answer: 42 }");
  });

  it.each(ruleCases)(
    "repairs %s values without dropping rule fields",
    (name, makeRule) => {
      const input = { rules: [makeRule("{ answer: 42 }")] };
      const result = normalizeFeatureJSONValues(typeOnly, input);
      expect(result.rules).toEqual([makeRule('{"answer": 42}')]);
      expect(input.rules).toEqual([makeRule("{ answer: 42 }")]);
    },
  );

  it.each(ruleCases)("rejects unrepairable %s values", (name, makeRule) => {
    expect(() =>
      normalizeFeatureJSONValues(typeOnly, {
        rules: [makeRule("{ not-an-object }")],
      }),
    ).toThrow("Rule #1");
  });

  it.each(["null", "false", "0", '"hello"', "[]", '{ "a": 1 }'])(
    "preserves valid JSON %s exactly",
    (defaultValue) => {
      expect(normalizeFeatureJSONValues(typeOnly, { defaultValue })).toEqual({
        defaultValue,
      });
    },
  );

  it.each(["", " ", "{ not-an-object }"])(
    "rejects malformed default %j",
    (defaultValue) => {
      expect(() =>
        normalizeFeatureJSONValues(typeOnly, { defaultValue }),
      ).toThrow("Default value");
    },
  );

  it("does not add absent value fields on metadata-only writes", () => {
    const values: {
      defaultValue?: string;
      rules?: FeatureRule[];
      description: string;
    } = {
      description: "Updated",
    };
    expect(normalizeFeatureJSONValues(typeOnly, values)).toEqual({
      description: "Updated",
    });
  });

  it.each(["{ answer: 42 }", "{ not-an-object }"])(
    "preserves inherited default %s during snapshot creation",
    (defaultValue) => {
      const previous = { defaultValue };
      expect(
        normalizeFeatureJSONValues(
          typeOnly,
          {
            ...previous,
            description: "Updated",
            environmentsEnabled: { production: false },
          },
          previous,
        ),
      ).toEqual({
        ...previous,
        description: "Updated",
        environmentsEnabled: { production: false },
      });
      expect(() =>
        normalizeFeatureJSONValues(
          typeOnly,
          {
            defaultValue: "{ another-invalid-object }",
          },
          previous,
        ),
      ).toThrow(FeatureValueError);
    },
  );

  it.each(ruleCases)(
    "preserves unchanged legacy %s values",
    (name, makeRule) => {
      for (const value of ["{ answer: 42 }", "{ not-an-object }"]) {
        const previous = { rules: [makeRule(value)] };
        const changed = { rules: [{ ...makeRule(value), enabled: false }] };
        expect(normalizeFeatureJSONValues(typeOnly, changed, previous)).toEqual(
          changed,
        );
        expect(
          normalizeFeatureJSONValues(typeOnly, previous, previous),
        ).toEqual(previous);
      }
    },
  );

  it("validates changed rules without rejecting unchanged malformed siblings", () => {
    const legacy = {
      ...baseRule,
      type: "force",
      value: "{ not-an-object }",
    } as const;
    const input = {
      rules: [legacy, { ...legacy, id: "new", value: "{ answer: 42 }" }],
    };
    expect(
      normalizeFeatureJSONValues(typeOnly, input, { rules: [legacy] }).rules,
    ).toEqual([legacy, { ...input.rules[1], value: '{"answer": 42}' }]);
    expect(() =>
      normalizeFeatureJSONValues(
        typeOnly,
        {
          rules: [legacy, { ...legacy, id: "new" }],
        },
        { rules: [legacy] },
      ),
    ).toThrow("Rule #2");
  });

  it("matches reference variations by id when they are reordered", () => {
    const rule: FeatureRule = {
      ...baseRule,
      type: "experiment-ref",
      experimentId: "exp",
      variations: [
        { variationId: "0", value: "{ not-an-object }" },
        { variationId: "1", value: "{}" },
      ],
    };
    const reordered = {
      ...rule,
      variations: [
        { variationId: "1", value: "{ answer: 42 }" },
        rule.variations[0],
      ],
    };
    expect(
      normalizeFeatureJSONValues(
        typeOnly,
        { rules: [reordered] },
        { rules: [rule] },
      ).rules,
    ).toEqual([
      {
        ...reordered,
        variations: [
          { variationId: "1", value: '{"answer": 42}' },
          rule.variations[0],
        ],
      },
    ]);
  });

  it("does not exempt an extra malformed rule with a duplicate id", () => {
    const rule: FeatureRule = {
      ...baseRule,
      type: "force",
      value: "{ not-an-object }",
    };
    expect(() =>
      normalizeFeatureJSONValues(
        typeOnly,
        {
          rules: [rule, { ...rule }],
        },
        { rules: [rule] },
      ),
    ).toThrow("Rule #2");
  });

  it("does not exempt an extra malformed variation with a duplicate id", () => {
    const rule: FeatureRule = {
      ...baseRule,
      type: "experiment-ref",
      experimentId: "exp",
      variations: [{ variationId: "0", value: "{ not-an-object }" }],
    };
    expect(() =>
      normalizeFeatureJSONValues(
        typeOnly,
        {
          rules: [
            { ...rule, variations: [...rule.variations, ...rule.variations] },
          ],
        },
        { rules: [rule] },
      ),
    ).toThrow("variation #2");
  });

  it("does not inherit values from a different rule type", () => {
    const previous = {
      rules: [
        {
          ...baseRule,
          type: "force",
          value: "{ not-an-object }",
        } as FeatureRule,
      ],
    };
    expect(() =>
      normalizeFeatureJSONValues(
        typeOnly,
        {
          rules: [{ ...previous.rules[0], type: "rollout" } as FeatureRule],
        },
        previous,
      ),
    ).toThrow(FeatureValueError);
  });

  it("preserves unknown rule types and scrubs nullish slots", () => {
    const unknown = {
      ...baseRule,
      type: "future-rule",
      value: "{ untouched }",
    } as unknown as FeatureRule;
    expect(
      normalizeFeatureJSONValues(typeOnly, {
        rules: [null, undefined, unknown] as unknown as FeatureRule[],
      }).rules,
    ).toEqual([unknown]);
  });

  it("tolerates missing legacy variation arrays", () => {
    const rule = {
      ...baseRule,
      type: "experiment-ref",
      experimentId: "exp",
    } as FeatureRule;
    expect(
      normalizeFeatureJSONValues(typeOnly, { rules: [rule] }).rules,
    ).toEqual([rule]);
  });

  it("reports a missing required value as a client validation error", () => {
    const rule = { ...baseRule, type: "force" } as FeatureRule;
    expect(() =>
      normalizeFeatureJSONValues(typeOnly, { rules: [rule] }),
    ).toThrow("Rule #1: A JSON value is required.");
    try {
      normalizeFeatureJSONValues(typeOnly, { rules: [rule] });
    } catch (e) {
      expect(e).toMatchObject({ status: 400 });
    }
  });

  it("leaves string feature values untouched", () => {
    expect(
      normalizeFeatureJSONValues(
        { valueType: "string" },
        { defaultValue: "{ not-an-object }" },
      ),
    ).toEqual({ defaultValue: "{ not-an-object }" });
  });
});

describe("schema validation overrides", () => {
  const context = (skip: boolean, warn = false): ReqContext =>
    ({
      canSkipSchemaValidationFor: () => skip,
      ignoreWarnings: warn,
      org: { settings: { blockPublishOnSchemaError: !warn } },
    }) as ReqContext;

  it.each([assertFeatureValuesValid, assertFeatureValuesValidForPublish])(
    "%p bypasses schema constraints but rejects malformed defaults",
    (validate) => {
      expect(() =>
        validate(context(false), jsonFeature, { defaultValue: "{}" }),
      ).toThrow();
      expect(() =>
        validate(context(true), jsonFeature, { defaultValue: "{}" }),
      ).not.toThrow();
      expect(() =>
        validate(context(true), jsonFeature, {
          defaultValue: "{ not-an-object }",
        }),
      ).toThrow();
      expect(() =>
        validate(
          context(true),
          { valueType: "number" },
          { defaultValue: "not a number" },
        ),
      ).toThrow();
      expect(() =>
        validate(
          context(true),
          { valueType: "boolean" },
          { defaultValue: "TRUE" },
        ),
      ).toThrow();
    },
  );

  it.each(ruleCases)(
    "cannot skip malformed %s rule values",
    (name, makeRule) => {
      const values = { rules: [makeRule("{ not-an-object }")] };
      expect(() =>
        assertFeatureValuesValid(context(true), jsonFeature, values),
      ).toThrow();
      expect(() =>
        assertFeatureValuesValidForPublish(context(true), jsonFeature, values),
      ).toThrow();
      expect(() =>
        assertFeatureValuesValidForPublish(
          context(false, true),
          jsonFeature,
          values,
        ),
      ).toThrow();
    },
  );

  it("ignores carried-forward invalid values but still rejects changed values at publish", () => {
    const previous = { defaultValue: "{ not-an-object }" };
    expect(() =>
      assertFeatureValuesValidForPublish(
        context(false),
        jsonFeature,
        previous,
        previous,
      ),
    ).not.toThrow();
    expect(() =>
      assertFeatureValuesValidForPublish(
        context(true),
        jsonFeature,
        { defaultValue: "{ another-invalid-object }" },
        previous,
      ),
    ).toThrow();
  });

  it("still permits acknowledged schema warnings at publish", () => {
    expect(() =>
      assertFeatureValuesValidForPublish(context(false, true), jsonFeature, {
        defaultValue: "{}",
      }),
    ).not.toThrow();
  });
});

describe("legacy revision drift repair", () => {
  it("converges after one repair without changing the stored revision", () => {
    const live = {
      defaultValue: "{ answer: 42 }",
      rules: [
        { ...baseRule, type: "force", value: "{ forced: 1 }" } as FeatureRule,
      ],
    };
    const feature = {
      valueType: "json" as const,
      defaultValue: "{}",
      rules: [],
    };
    const repaired = getFeatureValuesForDriftRepair(feature, live);
    expect(repaired.defaultValue).toBe('{"answer": 42}');
    expect(repaired.rules).toEqual([
      { ...live.rules[0], value: '{"forced": 1}' },
    ]);
    expect(
      getFeatureValuesForDriftRepair({ ...feature, ...repaired }, live),
    ).toEqual(repaired);
    expect(live.defaultValue).toBe("{ answer: 42 }");
  });

  it.each(["{ answer: 42 }", "{ not-an-object }"])(
    "leaves matching legacy values %s untouched",
    (defaultValue) => {
      const feature = { valueType: "json" as const, defaultValue };
      expect(getFeatureValuesForDriftRepair(feature, { defaultValue })).toEqual(
        { defaultValue },
      );
    },
  );

  it("can restore an unrepairable stored value without blocking recovery", () => {
    const live = { defaultValue: "{ not-an-object }" };
    const feature = { valueType: "json" as const, defaultValue: "{}" };
    const repaired = getFeatureValuesForDriftRepair(feature, live);
    expect(repaired).toEqual(live);
    expect(
      getFeatureValuesForDriftRepair({ ...feature, ...repaired }, live),
    ).toEqual(live);
    expect(() => normalizeFeatureJSONValues(feature, live)).toThrow(
      FeatureValueError,
    );
  });
});
