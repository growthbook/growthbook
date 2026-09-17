import { FeatureInterface, FeatureRule } from "shared/types/feature";
import { ReqContext } from "back-end/types/request";
import { normalizeFeatureJSONValues } from "back-end/src/util/featureValues";
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

  it("still permits acknowledged schema warnings at publish", () => {
    expect(() =>
      assertFeatureValuesValidForPublish(context(false, true), jsonFeature, {
        defaultValue: "{}",
      }),
    ).not.toThrow();
  });
});
