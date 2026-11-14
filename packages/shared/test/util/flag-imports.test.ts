import {
  buildFlagImportExperimentBody,
  buildFlagImportFeatureBody,
  getFlagImportLimitProblems,
  mapFlagImportEnvironments,
  planFlagImport,
  previewFlagImport,
  selectFlagImportFlags,
} from "../../src/util/flag-imports";
import {
  findFlagsJsonProblems,
  FLAG_IMPORT_MAX_PROBLEMS,
  FlagsJson,
  flagsJsonValidator,
} from "../../src/validators";

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
      result.flags.map((f) => [f.key, f.valueType, !f.unsupported.length]),
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
    expect(result.flags.map((f) => !f.unsupported.length)).toEqual([
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

describe("choices made before importing", () => {
  const file = flagsJsonValidator.parse({
    features: {
      legacyGate: {
        defaultValue: false,
        rules: [
          { condition: { env: { $ne: "production" } }, force: true },
          { condition: { plan: "enterprise" }, force: true },
        ],
      },
      gated: {
        defaultValue: false,
        rules: [{ force: true, namespace: ["ns", 0, 0.5] }],
      },
      buttonCta: {
        defaultValue: "Buy now",
        rules: [{ variations: ["Buy now", "Get started"] }],
      },
      newCheckout: guideExample.features.newCheckout,
    },
  });
  const preview = (overrides = {}) =>
    Object.fromEntries(
      previewFlagImport(file, overrides).map((flag) => [flag.key, flag]),
    );

  it("previews every rule, and says which problems choosing environments fixes", () => {
    const { legacyGate, gated, buttonCta, newCheckout } = preview();

    expect(legacyGate.importable).toBe(false);
    expect(legacyGate.rules).toEqual([
      {
        index: 0,
        type: "force",
        condition: '{"env":{"$ne":"production"}}',
        environments: [],
        value: "true",
        coverage: null,
        hashAttribute: null,
        experiment: null,
        issue: "Rule 1 must match env with a plain value, $eq or $in",
        fixable: true,
      },
      {
        index: 1,
        type: "force",
        condition: '{"plan":"enterprise"}',
        environments: null,
        value: "true",
        coverage: null,
        hashAttribute: null,
        experiment: null,
        issue: null,
        fixable: false,
      },
    ]);

    expect(gated.importable).toBe(false);
    expect(gated.rules[0]).toMatchObject({ fixable: false });
    expect(gated.rules[0].issue).toContain("namespaces");

    expect(newCheckout.importable).toBe(true);
    expect(newCheckout.rules).toMatchObject([
      { type: "force", environments: ["dev", "staging"], condition: "" },
      {
        type: "rollout",
        environments: null,
        coverage: 0.2,
        hashAttribute: "id",
      },
    ]);

    expect(buttonCta.rules[0]).toMatchObject({
      type: "experiment",
      hashAttribute: "id",
      coverage: 1,
      experiment: {
        trackingKey: "buttonCta",
        variations: [
          { name: "Control", value: "Buy now", weight: 0.5 },
          { name: "Variation 1", value: "Get started", weight: 0.5 },
        ],
      },
    });
  });

  it("imports a rule in the environments chosen for it", () => {
    const overrides = {
      rules: { legacyGate: { "0": { environments: ["dev", "staging"] } } },
    };
    const flag = planFlagImport(file, overrides).flags.find(
      (f) => f.key === "legacyGate",
    );
    expect(flag?.unsupported).toEqual([]);
    expect(flag?.rules[0]).toEqual({
      type: "force",
      value: "true",
      condition: "",
      environments: ["dev", "staging"],
    });
    expect(preview(overrides).legacyGate).toMatchObject({
      importable: true,
      reason: null,
    });
  });

  it("imports the rest of a flag once the rule in the way is removed", () => {
    const overrides = {
      rules: {
        legacyGate: { "0": { remove: true as const } },
        gated: { "0": { remove: true as const } },
      },
    };
    const planned = planFlagImport(file, overrides);
    const legacyGate = planned.flags.find((f) => f.key === "legacyGate");
    expect(legacyGate).toMatchObject({ unsupported: [], ruleCount: 1 });
    expect(legacyGate?.rules).toEqual([
      {
        type: "force",
        value: "true",
        condition: '{"plan":"enterprise"}',
        environments: null,
      },
    ]);
    expect(planned.flags.find((f) => f.key === "gated")).toMatchObject({
      unsupported: [],
      rules: [],
    });
    // The rule keeps its position in the file, so a later fix still finds it.
    expect(preview(overrides).legacyGate.rules.map((r) => r.index)).toEqual([
      1,
    ]);
  });

  it("does not let chosen environments paper over another problem", () => {
    const flag = planFlagImport(file, {
      rules: { gated: { "0": { environments: ["dev"] } } },
    }).flags.find((f) => f.key === "gated");
    expect(flag?.unsupported).toHaveLength(1);
  });

  it("treats names like constructor as ordinary keys", () => {
    const odd = flagsJsonValidator.parse({
      features: {
        toString: {
          defaultValue: false,
          rules: [{ condition: { env: "constructor" }, force: true }],
        },
      },
    });
    // No fix and no mapping were given, so nothing may change.
    const planned = mapFlagImportEnvironments(
      planFlagImport(odd, { rules: {} }),
      {},
    );
    expect(planned.flags[0].unsupported).toEqual([]);
    expect(planned.flags[0].rules[0].environments).toEqual(["constructor"]);
    expect(planned.environments).toEqual(["constructor"]);
  });

  it("plans only the Feature Flags that were chosen", () => {
    const chosen = selectFlagImportFlags(file, ["newCheckout", "missing"]);
    expect(Object.keys(chosen.features)).toEqual(["newCheckout"]);
    const planned = planFlagImport(chosen);
    expect(planned.experiments).toEqual([]);
    expect(planned.attributes.map((a) => a.property)).toEqual(["id"]);
    expect(selectFlagImportFlags(file)).toBe(file);
  });

  it("swaps environment names for the workspace's own", () => {
    const mapped = mapFlagImportEnvironments(
      planFlagImport(selectFlagImportFlags(file, ["newCheckout"])),
      { dev: "development", staging: "development" },
    );
    expect(mapped.environments).toEqual(["development"]);
    expect(mapped.summary.environments).toEqual(["development"]);
    expect(mapped.flags[0].rules[0].environments).toEqual(["development"]);
    expect(mapped.flags[0].rules[1].environments).toBeNull();
  });
});

describe("findFlagsJsonProblems", () => {
  const paths = (problems: string[]) =>
    problems.map((line) => line.slice(1, line.indexOf("]")));

  it("finds nothing wrong with the examples", () => {
    expect(findFlagsJsonProblems(guideExample)).toEqual([]);
    expect(findFlagsJsonProblems(sdkExample)).toEqual([]);
  });

  it("lists each problem with its path, as the full check does", () => {
    expect(
      findFlagsJsonProblems({
        features: {
          "bad key": { defaultValue: true },
          b: { rules: [{ force: true, coverage: 2 }] },
        },
      }),
    ).toEqual([
      "[features.bad key] Feature keys can only include letters, numbers, and the characters _, -, ., :, and |.",
      "[features.b.defaultValue] defaultValue is required",
      "[features.b.rules.0.coverage] Too big: expected number to be <=1",
    ]);
  });

  it.each<[string, unknown]>([
    ["not an object", "flags"],
    ["no features", {}],
    ["an empty upload", { features: {} }],
    ["a field the payload does not have", { features: {}, owner: "me" }],
    ["a flag that is not an object", { features: { a: true } }],
    ["a missing default value", { features: { a: { rules: [] } } }],
    [
      "a rule that is not an object",
      { features: { a: { defaultValue: 1, rules: [0] } } },
    ],
    [
      "a rule field the payload does not have",
      { features: { a: { defaultValue: 1, rules: [{ percent: 10 }] } } },
    ],
    [
      "a hash version that does not exist",
      { features: { a: { defaultValue: 1, rules: [{ hashVersion: 3 }] } } },
    ],
    [
      "too many rules",
      { features: { a: { defaultValue: 1, rules: Array(101).fill({}) } } },
    ],
    [
      "too many variations",
      {
        features: {
          a: { defaultValue: 1, rules: [{ variations: Array(101).fill(1) }] },
        },
      },
    ],
    [
      "too many Feature Flags",
      {
        features: Object.fromEntries(
          Array.from({ length: 201 }, (_, i) => [`f${i}`, { defaultValue: 1 }]),
        ),
      },
    ],
    [
      "a visual experiment with one variation",
      { features: {}, experiments: [{ key: "a", variations: [{}] }] },
    ],
    [
      "too many visual experiments",
      {
        features: { a: { defaultValue: 1 } },
        experiments: Array(101).fill({ key: "a", variations: [{}, {}] }),
      },
    ],
  ])("refuses what the full check refuses: %s", (_, file) => {
    expect(flagsJsonValidator.safeParse(file).success).toBe(false);
    expect(findFlagsJsonProblems(file).length).toBeGreaterThan(0);
  });

  it("refuses a file nested deeper than anything reads it", () => {
    const nest = (levels: number) => {
      let value: unknown = 1;
      for (let i = 0; i < levels; i++) value = { a: value };
      return value;
    };
    const file = (condition: unknown) => ({
      features: {
        a: { defaultValue: false, rules: [{ force: true, condition }] },
      },
    });
    expect(findFlagsJsonProblems(file(nest(20)))).toEqual([]);
    expect(flagsJsonValidator.safeParse(file(nest(20))).success).toBe(true);

    expect(findFlagsJsonProblems(file(nest(30000)))).toEqual([
      "[] The file nests more than 50 levels deep",
    ]);
    expect(flagsJsonValidator.safeParse(file(nest(60))).success).toBe(false);
  });

  it("names the rule field a bad union value is in", () => {
    expect(
      paths(
        findFlagsJsonProblems({
          features: { a: { defaultValue: 1, rules: [{ hashVersion: 3 }] } },
        }),
      ),
    ).toEqual(["features.a.rules.0.hashVersion"]);
  });

  it.each<[string, unknown]>([
    [
      "every rule a number",
      {
        features: {
          a: { defaultValue: 1, rules: Array(110000).fill(0) },
          b: { defaultValue: 1, rules: Array(110000).fill(0) },
        },
      },
    ],
    [
      "bad rules in every Feature Flag, within every limit",
      {
        features: Object.fromEntries(
          Array.from({ length: 200 }, (_, i) => [
            `f${i}`,
            { defaultValue: 1, rules: Array(100).fill(0) },
          ]),
        ),
      },
    ],
    [
      "one rule with a list of bad weights",
      {
        features: {
          a: {
            defaultValue: 1,
            rules: [{ variations: [0, 1], weights: Array(60000).fill("x") }],
          },
        },
      },
    ],
    [
      "one rule with every list full of bad entries",
      {
        features: {
          a: {
            defaultValue: 1,
            rules: [
              {
                meta: Array(100).fill({ key: 1, name: 2, passthrough: 3 }),
                weights: Array(100).fill("x"),
                ranges: Array(100).fill(["a", "b"]),
                filters: Array(100).fill(0),
                parentConditions: Array(100).fill({ id: 1, condition: 2 }),
              },
            ],
          },
        },
      },
    ],
    [
      "thousands of bad keys",
      {
        features: Object.fromEntries(
          Array.from({ length: 30000 }, (_, i) => [`bad key ${i}!`, 0]),
        ),
      },
    ],
    [
      "thousands of bad visual experiments",
      { experiments: Array(50000).fill(0) },
    ],
    [
      "thousands of fields the payload does not have",
      Object.fromEntries(Array.from({ length: 20000 }, (_, i) => [`x${i}`, 0])),
    ],
  ])("stops early on a file built to fail everywhere: %s", (_, file) => {
    const problems = findFlagsJsonProblems(file);
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.length).toBeLessThanOrEqual(FLAG_IMPORT_MAX_PROBLEMS + 1);
    expect(
      Math.max(...problems.map((line) => line.length)),
    ).toBeLessThanOrEqual(300);
  });

  it("says when there were more problems than it lists", () => {
    const problems = findFlagsJsonProblems({
      features: { a: { defaultValue: 1, rules: Array(100).fill(0) } },
    });
    expect(problems).toHaveLength(FLAG_IMPORT_MAX_PROBLEMS + 1);
    expect(problems[FLAG_IMPORT_MAX_PROBLEMS]).toBe(
      `Only the first ${FLAG_IMPORT_MAX_PROBLEMS} problems are listed.`,
    );
  });
});

describe("what one import may add", () => {
  const plan = (features: FlagsJson["features"]) =>
    planFlagImport(flagsJsonValidator.parse({ features }));

  it("asks where a rule runs when its environment could not be created", () => {
    const file = flagsJsonValidator.parse({
      features: {
        a: {
          defaultValue: false,
          rules: [{ condition: { env: "my env!" }, force: true }],
        },
      },
    });
    const [flag] = previewFlagImport(file);
    expect(flag.importable).toBe(false);
    expect(flag.rules[0]).toMatchObject({
      fixable: true,
      issue: 'Rule 1 names an environment GrowthBook cannot create: "my env!"',
    });

    const fixed = planFlagImport(file, {
      rules: { a: { "0": { environments: ["production"] } } },
    });
    expect(fixed.flags[0].unsupported).toEqual([]);
    expect(fixed.environments).toEqual(["production"]);
  });

  it("keeps out a rule whose attribute name has no end", () => {
    const long = "a".repeat(101);
    const planned = plan({
      a: {
        defaultValue: false,
        rules: [{ condition: { [long]: 1 }, force: true }],
      },
      b: {
        defaultValue: false,
        rules: [{ force: true, coverage: 0.5, hashAttribute: long }],
      },
    });
    expect(planned.flags.map((flag) => flag.unsupported)).toEqual([
      ["Rule 1 uses an attribute name longer than 100 characters"],
      ["Rule 1 uses an attribute name longer than 100 characters"],
    ]);
    expect(planned.attributes).toEqual([]);
  });

  it("allows the examples", () => {
    expect(
      getFlagImportLimitProblems(
        planFlagImport(flagsJsonValidator.parse(guideExample)),
      ),
    ).toEqual([]);
  });

  it("refuses a plan that adds more than one import may", () => {
    const list = (n: number, prefix: string) =>
      Array.from({ length: n }, (_, i) => `${prefix}${i}`);

    expect(
      getFlagImportLimitProblems(
        plan({
          a: {
            defaultValue: false,
            rules: list(21, "env").map((env) => ({
              condition: { env },
              force: true,
            })),
          },
        }),
      ),
    ).toEqual(["It would add 21 environments. One import can add at most 20."]);

    expect(
      getFlagImportLimitProblems(
        plan({
          a: {
            defaultValue: false,
            rules: [
              {
                condition: Object.fromEntries(
                  list(101, "attr").map((name) => [name, 1]),
                ),
                force: true,
              },
            ],
          },
        }),
      ),
    ).toEqual(["It would add 101 attributes. One import can add at most 100."]);

    expect(
      getFlagImportLimitProblems(
        plan(
          Object.fromEntries(
            list(101, "flag").map((key) => [
              key,
              { defaultValue: "a", rules: [{ variations: ["a", "b"] }] },
            ]),
          ),
        ),
      ),
    ).toEqual([
      "It would add 101 experiments. One import can add at most 100.",
    ]);
  });
});
