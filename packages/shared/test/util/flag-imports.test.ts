import {
  buildFlagImportExperimentBody,
  buildFlagImportFeatureBody,
  getFlagImportFlags,
  planFlagImport,
} from "../../src/util/flag-imports";
import { FlagsJson, flagsJsonValidator } from "../../src/validators";

// The Quick start flags from the local flags.ts guide, as JSON.
const guideExample = {
  features: {
    newCheckout: {
      defaultValue: false,
      rules: [
        { condition: { env: { $in: ["dev", "staging"] } }, force: true },
        { force: true, coverage: 0.2, hashAttribute: "id" },
      ],
    },
    uploadLimitMb: {
      defaultValue: 10,
      rules: [{ condition: { plan: "pro" }, force: 20 }],
    },
  },
};

// The FallbackPayload example from the JS SDK docs, as JSON.
const sdkExample = {
  features: {
    dark_mode: { defaultValue: false },
    donut_price: {
      defaultValue: 2.5,
      rules: [{ condition: { plan: "pro", age: { $gte: 18 } }, force: 2 }],
    },
    button_cta: {
      defaultValue: "Click Here",
      rules: [{ hashAttribute: "id", variations: ["Click Here", "Buy Now"] }],
    },
  },
};

function plan(features: FlagsJson["features"]) {
  return planFlagImport(flagsJsonValidator.parse({ features }));
}

describe("flagsJsonValidator", () => {
  it("accepts the guide's and the SDK's examples", () => {
    expect(flagsJsonValidator.safeParse(guideExample).success).toBe(true);
    expect(flagsJsonValidator.safeParse(sdkExample).success).toBe(true);
  });

  it("accepts the keys an SDK payload carries", () => {
    const result = flagsJsonValidator.safeParse({
      status: 200,
      dateUpdated: "2026-11-09T00:00:00.000Z",
      savedGroups: {},
      features: {
        banner: {
          defaultValue: "a",
          rules: [
            {
              id: "fr_1",
              key: "banner-test",
              variations: ["a", "b"],
              weights: [0.5, 0.5],
              meta: [{ key: "0", name: "Control" }, { key: "1" }],
              hashVersion: 2,
              phase: "0",
              name: "Banner test",
            },
          ],
        },
      },
      experiments: [
        { key: "redirect", variations: [{}, { urlRedirect: "/b" }] },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("requires a default value", () => {
    expect(
      flagsJsonValidator.safeParse({ features: { a: { rules: [] } } }).success,
    ).toBe(false);
  });

  it.each([
    [{ a: { defaultValue: true, owner: "me" } }],
    [{ a: { defaultValue: true, description: "A flag" } }],
    [{ a: { defaultValue: true, rules: [{ force: true, percent: 10 }] } }],
    [{ a: { defaultValue: true, rules: [{ force: true, description: "x" }] } }],
  ])("rejects a field the payload does not have: %j", (features) => {
    expect(flagsJsonValidator.safeParse({ features }).success).toBe(false);
  });

  it("reports every problem at once, each with its path", () => {
    const result = flagsJsonValidator.safeParse({
      features: {
        "bad key": { defaultValue: true },
        b: { rules: [{ force: true, coverage: 2 }] },
      },
    });
    expect(result.error?.issues.map((issue) => issue.path.join("."))).toEqual([
      "features.bad key",
      "features.b.defaultValue",
      "features.b.rules.0.coverage",
    ]);
  });

  it("rejects an empty upload", () => {
    expect(flagsJsonValidator.safeParse({ features: {} }).success).toBe(false);
  });
});

describe("planFlagImport", () => {
  it("plans the guide's example", () => {
    const result = planFlagImport(flagsJsonValidator.parse(guideExample));

    expect(result.warnings).toEqual([]);
    expect(result.summary).toEqual({
      flags: 2,
      rules: 3,
      experiments: 0,
      environments: ["dev", "staging"],
      attributes: ["id", "plan"],
    });
    expect(result.attributes).toEqual([
      { property: "id", datatype: "string", hashAttribute: true },
      { property: "plan", datatype: "string", hashAttribute: false },
    ]);

    const [checkout, upload] = result.flags;
    expect(checkout).toMatchObject({
      key: "newCheckout",
      valueType: "boolean",
      defaultValue: "false",
      unsupported: [],
    });
    expect(checkout.rules).toEqual([
      {
        type: "force",
        condition: "",
        environments: ["dev", "staging"],
        value: "true",
      },
      {
        type: "rollout",
        condition: "",
        environments: null,
        value: "true",
        coverage: 0.2,
        hashAttribute: "id",
        seed: "newCheckout",
        hashVersion: 1,
      },
    ]);
    expect(upload).toMatchObject({ valueType: "number", defaultValue: "10" });
    expect(upload.rules).toEqual([
      {
        type: "force",
        condition: '{"plan":"pro"}',
        environments: null,
        value: "20",
      },
    ]);
  });

  it("plans the SDK's example, experiment rule included", () => {
    const result = planFlagImport(flagsJsonValidator.parse(sdkExample));

    expect(result.warnings).toEqual([]);
    expect(
      getFlagImportFlags(result).map((f) => [f.key, f.valueType, f.importable]),
    ).toEqual([
      ["dark_mode", "boolean", true],
      ["donut_price", "number", true],
      ["button_cta", "string", true],
    ]);
    expect(result.experiments).toEqual([
      {
        trackingKey: "button_cta",
        name: "button_cta",
        hashAttribute: "id",
        hashVersion: 1,
        seed: "button_cta",
        coverage: 1,
        condition: "",
        weights: [0.5, 0.5],
        variations: [
          { key: "0", name: "Control" },
          { key: "1", name: "Variation 1" },
        ],
      },
    ]);
    expect(result.attributes.map((a) => [a.property, a.datatype])).toEqual([
      ["plan", "string"],
      ["age", "number"],
      ["id", "string"],
    ]);
  });

  it("reads each allowed way of matching env and keeps the rest", () => {
    const { flags, environments } = plan({
      a: {
        defaultValue: false,
        rules: [
          { force: true, condition: { env: "production", plan: "pro" } },
          { force: true, condition: { env: { $eq: "dev" } } },
          { force: true, condition: { env: { $in: ["qa", "qa", "dev"] } } },
        ],
      },
    });
    expect(flags[0].rules.map((r) => [r.environments, r.condition])).toEqual([
      [["production"], '{"plan":"pro"}'],
      [["dev"], ""],
      [["qa", "dev"], ""],
    ]);
    expect(environments).toEqual(["production", "dev", "qa"]);
  });

  it.each([
    [{ env: { $ne: "production" } }],
    [{ env: { $nin: ["production"] } }],
    [{ env: { $in: [] } }],
    [{ env: { $regex: "^prod" } }],
    [{ $or: [{ env: "dev" }, { plan: "pro" }] }],
    [{ $not: { env: "production" } }],
  ])("keeps a flag out when env is matched as %j", (condition) => {
    const result = plan({
      a: { defaultValue: false, rules: [{ force: true, condition }] },
      b: { defaultValue: 1 },
    });
    expect(result.flags[0].unsupported).toHaveLength(1);
    expect(result.warnings).toEqual([
      { path: "features.a", message: result.flags[0].unsupported[0] },
    ]);
    expect(result.environments).toEqual([]);
    expect(getFlagImportFlags(result).map((f) => f.importable)).toEqual([
      false,
      true,
    ]);
  });

  it("stores each value type the way a Feature Flag does", () => {
    const { flags, warnings } = plan({
      text: { defaultValue: "a", rules: [{ force: "b" }] },
      config: { defaultValue: { size: 1 }, rules: [{ force: { size: 2 } }] },
      list: { defaultValue: [1, 2] },
      empty: { defaultValue: null },
      mixed: { defaultValue: false, rules: [{ force: "blue" }] },
    });
    expect(
      flags.map((f) => [f.valueType, f.defaultValue, f.rules[0]?.type]),
    ).toEqual([
      ["string", "a", "force"],
      ["json", '{"size":1}', "force"],
      ["json", "[1,2]", undefined],
      ["json", "null", undefined],
      ["json", "false", "force"],
    ]);
    expect(flags[4].rules[0]).toMatchObject({ value: '"blue"' });
    expect(warnings).toEqual([
      {
        path: "features.mixed",
        message: "Its values have different types, so it is imported as JSON",
      },
    ]);
  });

  it("keeps an explicit rollout seed and hash version", () => {
    const { flags } = plan({
      a: {
        defaultValue: false,
        rules: [
          {
            force: true,
            coverage: 0.5,
            hashAttribute: "deviceId",
            seed: "s1",
            hashVersion: 2,
          },
          { force: true, coverage: 1 },
        ],
      },
    });
    expect(flags[0].rules[0]).toMatchObject({
      type: "rollout",
      hashAttribute: "deviceId",
      seed: "s1",
      hashVersion: 2,
    });
    expect(flags[0].rules[1].type).toBe("force");
  });

  it("turns a rule with variations into an experiment", () => {
    const result = plan({
      ctaColor: {
        defaultValue: "blue",
        rules: [
          {
            variations: ["blue", "green", "red"],
            condition: { env: "production", country: { $in: ["US", "CA"] } },
            coverage: 0.5,
          },
        ],
      },
    });
    expect(result.warnings).toEqual([]);
    expect(result.experiments).toEqual([
      {
        trackingKey: "ctaColor",
        name: "ctaColor",
        hashAttribute: "id",
        hashVersion: 1,
        seed: "ctaColor",
        coverage: 0.5,
        condition: '{"country":{"$in":["US","CA"]}}',
        weights: [1 / 3, 1 / 3, 1 / 3],
        variations: [
          { key: "0", name: "Control" },
          { key: "1", name: "Variation 1" },
          { key: "2", name: "Variation 2" },
        ],
      },
    ]);
    expect(result.flags[0].rules).toEqual([
      {
        type: "experiment",
        condition: "",
        environments: ["production"],
        trackingKey: "ctaColor",
        values: ["blue", "green", "red"],
      },
    ]);
    expect(result.summary.experiments).toBe(1);
    expect(result.attributes.map((a) => a.property)).toEqual(["id", "country"]);
  });

  it("uses the experiment's own key, name, weights and variation names", () => {
    const { experiments } = plan({
      a: {
        defaultValue: false,
        rules: [
          {
            key: "checkout-test",
            name: "Checkout test",
            variations: [false, true],
            weights: [0.8, 0.2],
            hashAttribute: "deviceId",
            hashVersion: 2,
            seed: "abc",
            meta: [{ key: "control", name: "Old" }, { key: "new" }],
          },
        ],
      },
    });
    expect(experiments[0]).toMatchObject({
      trackingKey: "checkout-test",
      name: "Checkout test",
      hashAttribute: "deviceId",
      hashVersion: 2,
      seed: "abc",
      weights: [0.8, 0.2],
      variations: [
        { key: "control", name: "Old" },
        { key: "new", name: "Variation 1" },
      ],
    });
  });

  it("shares one experiment between flags only when it is defined the same", () => {
    const rule = { key: "shared", variations: [false, true] };
    const same = plan({
      a: { defaultValue: false, rules: [rule] },
      b: { defaultValue: false, rules: [rule] },
    });
    expect(same.experiments).toHaveLength(1);
    expect(same.warnings).toEqual([]);

    const different = plan({
      a: { defaultValue: false, rules: [rule] },
      b: { defaultValue: false, rules: [{ ...rule, coverage: 0.1 }] },
    });
    expect(different.experiments).toHaveLength(1);
    expect(different.flags.map((f) => f.unsupported.length)).toEqual([0, 1]);
  });

  it.each([
    [{ force: true, parentConditions: [{ id: "x", condition: {} }] }],
    [{ force: true, namespace: ["ns", 0, 0.5] as [string, number, number] }],
    [{ force: true, condition: { id: { $inGroup: "grp_1" } } }],
    [{ force: true, variations: [false, true] }],
    [{ variations: [false, true], weights: [1] }],
    [{ coverage: 0.5 }],
    [{ variations: [false, true], fallbackAttribute: "deviceId" }],
  ])("keeps a flag out when a rule is %j", (rule) => {
    const result = plan({ a: { defaultValue: false, rules: [rule] } });
    expect(result.flags[0].unsupported).toHaveLength(1);
    expect(result.experiments).toEqual([]);
    expect(result.attributes).toEqual([]);
  });

  it("guesses attribute types from how conditions use them", () => {
    const { attributes } = plan({
      a: {
        defaultValue: false,
        rules: [
          { force: true, coverage: 0.2, hashAttribute: "anonymousId" },
          {
            force: true,
            condition: {
              beta: true,
              age: { $gte: 18 },
              appVersion: { $vgt: "1.5.6" },
              tags: { $all: ["a", "b"] },
              scores: { $elemMatch: { $gt: 5 } },
              "company.country": "US",
              $or: [{ country: "US" }, { $not: { tier: { $in: [1, 2] } } }],
              seen: { $exists: true },
            },
          },
        ],
      },
    });
    expect(attributes).toEqual([
      { property: "anonymousId", datatype: "string", hashAttribute: true },
      { property: "beta", datatype: "boolean", hashAttribute: false },
      { property: "age", datatype: "number", hashAttribute: false },
      {
        property: "appVersion",
        datatype: "string",
        hashAttribute: false,
        format: "version",
      },
      { property: "tags", datatype: "string[]", hashAttribute: false },
      { property: "scores", datatype: "number[]", hashAttribute: false },
      { property: "company.country", datatype: "string", hashAttribute: false },
      { property: "country", datatype: "string", hashAttribute: false },
      { property: "tier", datatype: "number", hashAttribute: false },
      { property: "seen", datatype: "string", hashAttribute: false },
    ]);
  });

  it("lists visual and redirect experiments without importing them", () => {
    const result = planFlagImport(
      flagsJsonValidator.parse({
        features: { a: { defaultValue: true } },
        experiments: [{ key: "r", variations: [{}, { urlRedirect: "/b" }] }],
      }),
    );
    expect(result.summary.experiments).toBe(1);
    expect(result.warnings).toEqual([
      {
        path: "experiments[0]",
        message:
          "Visual editor and URL redirect experiments are not imported yet",
      },
    ]);
  });
});

describe("buildFlagImportFeatureBody", () => {
  it("builds the create request for the guide's example", () => {
    const { flags } = planFlagImport(flagsJsonValidator.parse(guideExample));
    const { body, droppedRules } = buildFlagImportFeatureBody(flags[0], {
      project: "prj_1",
      environmentIds: ["dev", "production", "staging"],
      experiments: {},
    });
    expect(droppedRules).toBe(0);
    expect(body).toEqual({
      id: "newCheckout",
      project: "prj_1",
      valueType: "boolean",
      defaultValue: "false",
      environments: {
        dev: { enabled: true },
        production: { enabled: true },
        staging: { enabled: true },
      },
      rules: [
        {
          type: "force",
          value: "true",
          allEnvironments: false,
          environments: ["dev", "staging"],
        },
        {
          type: "rollout",
          value: "true",
          allEnvironments: true,
          coverage: 0.2,
          hashAttribute: "id",
          seed: "newCheckout",
          hashVersion: 1,
        },
      ],
    });
  });

  it("leaves out a rule whose environments the workspace lacks", () => {
    const { flags } = planFlagImport(flagsJsonValidator.parse(guideExample));
    const partial = buildFlagImportFeatureBody(flags[0], {
      environmentIds: ["dev", "production"],
      experiments: {},
    });
    expect(partial.droppedRules).toBe(0);
    expect(partial.body.rules?.[0]).toMatchObject({ environments: ["dev"] });

    const none = buildFlagImportFeatureBody(flags[0], {
      environmentIds: ["production"],
      experiments: {},
    });
    expect(none.droppedRules).toBe(1);
    expect(none.body.rules?.map((r) => r.type)).toEqual(["rollout"]);
    expect(none.body.project).toBeUndefined();
  });

  it("links an experiment rule to the experiment that was created", () => {
    const result = plan({
      a: {
        defaultValue: false,
        rules: [{ key: "t", variations: [false, true], condition: { x: 1 } }],
      },
    });
    const { body } = buildFlagImportFeatureBody(result.flags[0], {
      environmentIds: ["production"],
      experiments: { t: { id: "exp_1", variationIds: ["var_a", "var_b"] } },
    });
    expect(body.rules).toEqual([
      {
        type: "experiment-ref",
        allEnvironments: true,
        experimentId: "exp_1",
        variations: [
          { value: "false", variationId: "var_a" },
          { value: "true", variationId: "var_b" },
        ],
      },
    ]);
    expect(() =>
      buildFlagImportFeatureBody(result.flags[0], {
        environmentIds: ["production"],
        experiments: {},
      }),
    ).toThrow("Missing experiment t");
  });
});

describe("buildFlagImportExperimentBody", () => {
  it("carries the bucketing settings onto the first phase", () => {
    const { experiments } = plan({
      a: {
        defaultValue: false,
        rules: [
          { key: "t", variations: [false, true], condition: { plan: "pro" } },
        ],
      },
    });
    expect(
      buildFlagImportExperimentBody(experiments[0], {
        project: "prj_1",
        dateStarted: "2026-11-09T00:00:00.000Z",
      }),
    ).toEqual({
      trackingKey: "t",
      name: "t",
      project: "prj_1",
      assignmentQuery: { id: "" },
      hashAttribute: "id",
      hashVersion: 1,
      variations: [
        { key: "0", name: "Control" },
        { key: "1", name: "Variation 1" },
      ],
      phases: [
        {
          name: "Main",
          dateStarted: "2026-11-09T00:00:00.000Z",
          coverage: 1,
          seed: "t",
          variationWeights: [0.5, 0.5],
          targetingCondition: '{"plan":"pro"}',
        },
      ],
    });
  });
});
