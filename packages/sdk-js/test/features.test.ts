import { Context, Experiment, GrowthBook } from "../src";

/* eslint-disable */
const { webcrypto } = require("node:crypto");
import { TextEncoder, TextDecoder } from "util";
global.TextEncoder = TextEncoder;
(global as any).TextDecoder = TextDecoder;
/* eslint-enable */

const mockCallback = (context: Context) => {
  const onFeatureUsage = jest.fn((a) => {
    return a;
  });
  context.onFeatureUsage = onFeatureUsage;
  return onFeatureUsage.mock;
};

describe("features", () => {
  it("renders when features are set", () => {
    const context: Context = {
      user: { id: "1" },
    };
    const growthbook = new GrowthBook(context);
    let called = false;
    growthbook.setRenderer(() => {
      called = true;
    });

    expect(called).toEqual(false);
    growthbook.setFeatures({ id: {} });
    expect(called).toEqual(true);

    growthbook.destroy();
  });

  it("decrypts features with custom SubtleCrypto implementation", async () => {
    const growthbook = new GrowthBook();

    const keyString = "Ns04T5n9+59rl2x3SlNHtQ==";
    const encryptedFeatures =
      "vMSg2Bj/IurObDsWVmvkUg==.L6qtQkIzKDoE2Dix6IAKDcVel8PHUnzJ7JjmLjFZFQDqidRIoCxKmvxvUj2kTuHFTQ3/NJ3D6XhxhXXv2+dsXpw5woQf0eAgqrcxHrbtFORs18tRXRZza7zqgzwvcznx";

    // Make sure it's not using the built-in crypto implementation
    const originalCrypto = globalThis.crypto;
    // eslint-disable-next-line
    (globalThis.crypto as any) = undefined;

    await growthbook.setEncryptedFeatures(
      encryptedFeatures,
      keyString,
      webcrypto.subtle,
    );

    expect(growthbook.getFeatures()).toEqual({
      testfeature1: {
        defaultValue: true,
        rules: [
          {
            condition: { id: "1234" },
            force: false,
          },
        ],
      },
    });

    growthbook.destroy();
    globalThis.crypto = originalCrypto;
  });

  it("decrypts features using the native SubtleCrypto implementation", async () => {
    const growthbook = new GrowthBook();

    const originalCrypto = globalThis.crypto;
    globalThis.crypto = webcrypto;

    const keyString = "Ns04T5n9+59rl2x3SlNHtQ==";
    const encryptedFeatures =
      "vMSg2Bj/IurObDsWVmvkUg==.L6qtQkIzKDoE2Dix6IAKDcVel8PHUnzJ7JjmLjFZFQDqidRIoCxKmvxvUj2kTuHFTQ3/NJ3D6XhxhXXv2+dsXpw5woQf0eAgqrcxHrbtFORs18tRXRZza7zqgzwvcznx";

    await growthbook.setEncryptedFeatures(encryptedFeatures, keyString);

    expect(growthbook.getFeatures()).toEqual({
      testfeature1: {
        defaultValue: true,
        rules: [
          {
            condition: { id: "1234" },
            force: false,
          },
        ],
      },
    });
    growthbook.destroy();

    // Reset
    globalThis.crypto = originalCrypto;
  });

  it("throws when decrypting features with invalid key", async () => {
    const growthbook = new GrowthBook();

    const keyString = "fakeT5n9+59rl2x3SlNHtQ==";
    const encryptedFeatures =
      "vMSg2Bj/IurObDsWVmvkUg==.L6qtQkIzKDoE2Dix6IAKDcVel8PHUnzJ7JjmLjFZFQDqidRIoCxKmvxvUj2kTuHFTQ3/NJ3D6XhxhXXv2+dsXpw5woQf0eAgqrcxHrbtFORs18tRXRZza7zqgzwvcznx";

    await expect(
      growthbook.setEncryptedFeatures(
        encryptedFeatures,
        keyString,
        webcrypto.subtle,
      ),
    ).rejects.toThrow("Failed to decrypt");

    growthbook.destroy();
  });

  it("throws when decrypting features with invalid encrypted value", async () => {
    const growthbook = new GrowthBook();

    const keyString = "Ns04T5n9+59rl2x3SlNHtQ==";
    const encryptedFeatures =
      "FAKE2Bj/IurObDsWVmvkUg==.L6qtQkIzKDoE2Dix6IAKDcVel8PHUnzJ7JjmLjFZFQDqidRIoCxKmvxvUj2kTuHFTQ3/NJ3D6XhxhXXv2+dsXpw5woQf0eAgqrcxHrbtFORs18tRXRZza7zqgzwvcznx";

    await expect(
      growthbook.setEncryptedFeatures(
        encryptedFeatures,
        keyString,
        webcrypto.subtle,
      ),
    ).rejects.toThrow();

    growthbook.destroy();
  });

  it("throws when decrypting features and no SubtleCrypto implementation exists", async () => {
    const growthbook = new GrowthBook();

    const keyString = "Ns04T5n9+59rl2x3SlNHtQ==";
    const encryptedFeatures =
      "vMSg2Bj/IurObDsWVmvkUg==.L6qtQkIzKDoE2Dix6IAKDcVel8PHUnzJ7JjmLjFZFQDqidRIoCxKmvxvUj2kTuHFTQ3/NJ3D6XhxhXXv2+dsXpw5woQf0eAgqrcxHrbtFORs18tRXRZza7zqgzwvcznx";

    const originalCrypto = globalThis.crypto;
    // eslint-disable-next-line
    (globalThis.crypto as any) = undefined;

    await expect(
      growthbook.setEncryptedFeatures(encryptedFeatures, keyString),
    ).rejects.toThrow("No SubtleCrypto implementation found");

    growthbook.destroy();
    globalThis.crypto = originalCrypto;
  });

  it("can set features asynchronously", () => {
    const growthbook = new GrowthBook({
      attributes: {
        id: "123",
      },
    });
    growthbook.setFeatures({
      feature: {
        defaultValue: 0,
      },
    });
    expect(growthbook.feature("feature")).toEqual({
      value: 0,
      on: false,
      off: true,
      ruleId: "",
      source: "defaultValue",
    });
    growthbook.destroy();
  });

  it("returns ruleId when evaluating a feature", () => {
    const growthbook = new GrowthBook({
      features: {
        feature: {
          defaultValue: 0,
          rules: [
            {
              force: 1,
              id: "foo",
            },
          ],
        },
      },
    });
    expect(growthbook.evalFeature("feature").ruleId).toEqual("foo");
    growthbook.destroy();
  });

  it("updates attributes with setAttributes", () => {
    const context: Context = {
      attributes: {
        foo: 1,
        bar: 2,
      },
    };

    const growthbook = new GrowthBook(context);

    growthbook.setAttributes({ foo: 2, baz: 3 });

    expect(context.attributes).toEqual({
      foo: 2,
      baz: 3,
    });
  });

  it("uses attribute overrides", () => {
    const growthbook = new GrowthBook({
      attributes: {
        id: "123",
        foo: "bar",
      },
    });

    growthbook.setAttributeOverrides({
      foo: "baz",
    });

    expect(growthbook.getAttributes()).toEqual({
      id: "123",
      foo: "baz",
    });
    expect(
      growthbook.run({
        key: "my-test",
        variations: [0, 1],
        hashAttribute: "foo",
      }).hashValue,
    ).toEqual("baz");

    growthbook.setAttributeOverrides({});
    expect(growthbook.getAttributes()).toEqual({
      id: "123",
      foo: "bar",
    });
    expect(
      growthbook.run({
        key: "my-test",
        variations: [0, 1],
        hashAttribute: "foo",
      }).hashValue,
    ).toEqual("bar");

    growthbook.destroy();
  });

  it("uses forced feature values", () => {
    const growthbook = new GrowthBook({
      features: {
        feature1: {
          defaultValue: 0,
        },
        feature2: {
          defaultValue: 0,
        },
      },
    });

    growthbook.setForcedFeatures(
      new Map(
        Object.entries({
          feature2: 1,
          feature3: 1,
        }),
      ),
    );

    expect(growthbook.feature("feature1").value).toEqual(0);
    expect(growthbook.feature("feature2").value).toEqual(1);
    expect(growthbook.feature("feature3").value).toEqual(1);

    growthbook.setForcedFeatures(new Map());
    expect(growthbook.feature("feature1").value).toEqual(0);
    expect(growthbook.feature("feature2").value).toEqual(0);
    expect(growthbook.feature("feature3").value).toEqual(null);

    growthbook.destroy();
  });

  it("gets features", () => {
    const features = {
      feature1: { defaultValue: 0 },
    };
    const growthbook = new GrowthBook({
      features,
    });

    expect(growthbook.getFeatures()).toEqual(features);

    growthbook.destroy();
  });

  it("fires feature usage callback", () => {
    const context: Context = {
      attributes: { id: "1" },
      features: {
        feature1: {
          defaultValue: 0,
        },
        feature3: {
          defaultValue: 1,
        },
      },
    };
    const growthbook = new GrowthBook(context);
    const forcedFeatures = new Map();
    forcedFeatures.set("feature3", 5);
    growthbook.setForcedFeatures(forcedFeatures);
    const mock = mockCallback(context);

    // Fires for regular features
    const res1 = growthbook.evalFeature("feature1");
    // Fires for unknown features
    const res2 = growthbook.evalFeature("feature2");
    // Does not fire for repeats
    growthbook.evalFeature("feature1");
    // Does not fire when value is forced via an override
    growthbook.evalFeature("feature3");

    expect(mock.calls.length).toEqual(2);
    expect(mock.calls[0]).toEqual(["feature1", res1]);
    expect(mock.calls[1]).toEqual(["feature2", res2]);

    growthbook.destroy();
  });

  it("re-fires feature usage when assigned value changes", () => {
    const context: Context = {
      attributes: { color: "green" },
      features: {
        feature: {
          defaultValue: 0,
          rules: [
            {
              condition: {
                color: "blue",
              },
              force: 1,
            },
          ],
        },
      },
    };
    const growthbook = new GrowthBook(context);
    const mock = mockCallback(context);

    // Fires for regular features
    const res1 = growthbook.evalFeature("feature");
    expect(res1.value).toEqual(0);
    growthbook.setAttributes({
      color: "blue",
    });
    // Fires when the assigned value changes
    const res2 = growthbook.evalFeature("feature");
    expect(res2.value).toEqual(1);

    expect(mock.calls.length).toEqual(2);
    expect(mock.calls[0]).toEqual(["feature", res1]);
    expect(mock.calls[1]).toEqual(["feature", res2]);

    growthbook.destroy();
  });

  it("uses fallbacks get getFeatureValue", () => {
    const growthbook = new GrowthBook({
      features: {
        feature: {
          defaultValue: "blue",
        },
      },
    });

    expect(growthbook.getFeatureValue("feature", "green")).toEqual("blue");
    expect(growthbook.getFeatureValue("unknown", "green")).toEqual("green");
    expect(growthbook.getFeatureValue("testing", null)).toEqual(null);

    growthbook.destroy();
  });

  it("fires remote tracking calls", async () => {
    const onExperimentViewed = jest.fn((a) => a);

    const exp: Experiment<number | null> = {
      key: "test",
      variations: [null, 1],
      name: "Test",
      phase: "1",
    };
    const result = {
      featureId: "feature",
      hashAttribute: "id",
      hashValue: "123",
      inExperiment: true,
      key: "v1",
      value: 1,
      variationId: 1,
      bucket: 0.1234,
      hashUsed: true,
      name: "variation 1",
    };

    const growthbook = new GrowthBook({
      trackingCallback: onExperimentViewed,
      features: {
        feature: {
          defaultValue: 0,
          rules: [
            {
              force: 1,
              tracks: [
                {
                  experiment: exp,
                  result: result,
                },
              ],
            },
          ],
        },
      },
    });

    const res = growthbook.evalFeature("feature");
    expect(res.value).toEqual(1);
    expect(res.source).toEqual("force");

    expect(onExperimentViewed.mock.calls.length).toEqual(1);
    expect(onExperimentViewed.mock.calls[0]).toEqual([exp, result]);

    growthbook.destroy();
  });

  it("gates flag rule evaluation on prerequisite flag", async () => {
    const growthbook = new GrowthBook({
      attributes: {
        id: "123",
        memberType: "basic",
        country: "USA",
      },
      features: {
        parentFlag: {
          defaultValue: "silver",
          rules: [
            {
              condition: { country: "Canada" },
              force: "red",
            },
            {
              condition: { country: { $in: ["USA", "Mexico"] } },
              force: "green",
            },
          ],
        },
        childFlag: {
          defaultValue: "default",
          rules: [
            {
              // Bailout (fail) if the parent flag value is not "green"
              parentConditions: [
                {
                  id: "parentFlag",
                  condition: { value: "green" },
                  gate: true,
                },
              ],
            },
            {
              condition: { memberType: "basic" },
              force: "success",
            },
          ],
        },
        childFlagWithMissingPrereq: {
          defaultValue: "default",
          rules: [
            {
              // Bailout (fail) if the parent flag value is not "green"
              parentConditions: [
                {
                  id: "missingParentFlag",
                  condition: { value: "green" },
                  gate: true,
                },
              ],
            },
          ],
        },
      },
    });

    const missingResult = growthbook.evalFeature("childFlagWithMissingPrereq");
    expect(missingResult.value).toEqual(null);

    const result1 = growthbook.evalFeature("childFlag");
    expect(result1.value).toEqual("success");

    growthbook.setAttributes({
      id: "123",
      memberType: "basic",
      country: "Canada",
    });

    const result2 = growthbook.evalFeature("childFlag");
    expect(result2.value).toEqual(null);

    growthbook.destroy();
  });

  it("gates experiment rule evaluation on prerequisite flag", async () => {
    const growthbook = new GrowthBook({
      attributes: {
        id: "1",
        country: "USA",
      },
      features: {
        parentFlag: {
          defaultValue: "silver",
          rules: [
            {
              condition: { country: "Canada" },
              force: "red",
            },
            {
              condition: { country: { $in: ["USA", "Mexico"] } },
              force: "green",
            },
          ],
        },
      },
      experiments: [
        {
          key: "childExperiment",
          variations: [{}, {}],
          meta: [
            {
              key: "v0",
              name: "variation 0",
            },
            {
              key: "v1",
              name: "variation 1",
            },
          ],
          parentConditions: [
            {
              id: "parentFlag",
              condition: { value: "green" },
            },
          ],
        },
      ],
    });

    const exp = growthbook.getExperiments()[0];
    const result1 = growthbook.run(exp);
    expect(result1.variationId).toEqual(1);

    growthbook.setAttributes({
      id: "123",
      memberType: "basic",
      country: "Canada",
    });

    const result2 = growthbook.run(exp);
    expect(result2.variationId).toEqual(0);

    growthbook.destroy();
  });

  it("gates flag rule evaluation on prerequisite experiment flag", async () => {
    const growthbook = new GrowthBook({
      attributes: {
        id: "1234",
        memberType: "basic",
        country: "USA",
      },
      features: {
        parentExperimentFlag: {
          defaultValue: 0,
          rules: [
            {
              key: "experiment",
              variations: [0, 1],
              hashAttribute: "id",
              hashVersion: 2,
              ranges: [
                [0, 0.5],
                [0.5, 1.0],
              ],
            },
          ],
        },
        childFlag: {
          defaultValue: "default",
          rules: [
            {
              // Bailout (fail) if the parent flag value is not 1
              parentConditions: [
                {
                  id: "parentExperimentFlag",
                  condition: { value: 1 },
                  gate: true,
                },
              ],
            },
            {
              condition: { memberType: "basic" },
              force: "success",
            },
          ],
        },
      },
    });

    const result1 = growthbook.evalFeature("childFlag");
    expect(result1.value).toEqual("success");

    growthbook.destroy();
  });

  it("conditionally applies a force rule based on prerequisite targeting", async () => {
    const growthbook = new GrowthBook({
      attributes: {
        id: "123",
        memberType: "basic",
        otherGatingProperty: "allow",
        country: "USA",
      },
      features: {
        parentFlag: {
          defaultValue: "silver",
          rules: [
            {
              condition: { country: "Canada" },
              force: "red",
            },
            {
              condition: { country: { $in: ["USA", "Mexico"] } },
              force: "green",
            },
          ],
        },
        childFlag: {
          defaultValue: "default",
          rules: [
            {
              // Only apply force rule if parentConditions pass
              parentConditions: [
                {
                  id: "parentFlag",
                  condition: { value: "green" },
                },
              ],
              condition: { otherGatingProperty: "allow" },
              force: "dark mode",
            },
            {
              condition: { memberType: "basic" },
              force: "light mode",
            },
          ],
        },
      },
    });

    const result1 = growthbook.evalFeature("childFlag");
    expect(result1.value).toEqual("dark mode");

    growthbook.setAttributes({
      id: "123",
      memberType: "basic",
      otherGatingProperty: "allow",
      country: "Canada",
    });

    const result2 = growthbook.evalFeature("childFlag");
    expect(result2.value).toEqual("light mode");

    growthbook.setAttributes({
      id: "123",
      memberType: "basic",
      otherGatingProperty: "deny",
      country: "USA",
    });

    const result3 = growthbook.evalFeature("childFlag");
    expect(result3.value).toEqual("light mode");

    growthbook.destroy();
  });

  it("conditionally applies a force rule based on prerequisite JSON targeting", async () => {
    const growthbook = new GrowthBook({
      attributes: {
        id: "123",
        memberType: "basic",
        country: "USA",
      },
      features: {
        parentFlag: {
          defaultValue: { foo: true, bar: {} },
          rules: [
            {
              condition: { country: "Canada" },
              force: { foo: true, bar: { color: "red" } },
            },
            {
              condition: { country: { $in: ["USA", "Mexico"] } },
              force: { foo: true, bar: { color: "green" } },
            },
          ],
        },
        childFlag: {
          defaultValue: "default",
          rules: [
            {
              // Only apply force rule if parentConditions pass
              parentConditions: [
                {
                  id: "parentFlag",
                  condition: { "value.bar.color": "green" },
                },
              ],
              force: "dark mode",
            },
            {
              condition: { memberType: "basic" },
              force: "light mode",
            },
          ],
        },
        childFlag2: {
          defaultValue: "default",
          rules: [
            {
              // Only apply force rule if parentConditions pass
              parentConditions: [
                {
                  id: "parentFlag",
                  condition: { value: { $exists: true } },
                },
              ],
              force: "dark mode",
            },
            {
              condition: { memberType: "basic" },
              force: "light mode",
            },
          ],
        },
      },
    });

    const result1a = growthbook.evalFeature("childFlag");
    expect(result1a.value).toEqual("dark mode");

    const result1b = growthbook.evalFeature("childFlag2");
    expect(result1b.value).toEqual("dark mode");

    growthbook.setAttributes({
      id: "123",
      memberType: "basic",
      otherGatingProperty: "allow",
      country: "Canada",
    });

    const result2 = growthbook.evalFeature("childFlag");
    expect(result2.value).toEqual("light mode");

    growthbook.destroy();
  });

  it("returns null when hitting a prerequisite cycle", async () => {
    const growthbook = new GrowthBook({
      attributes: {
        id: "123",
        memberType: "basic",
        country: "USA",
      },
      features: {
        parentFlag: {
          defaultValue: "silver",
          rules: [
            {
              parentConditions: [
                {
                  id: "childFlag",
                  condition: { $not: { value: "success" } },
                },
              ],
              force: null,
            },
            {
              condition: { country: "Canada" },
              force: "red",
            },
            {
              condition: { country: { $in: ["USA", "Mexico"] } },
              force: "green",
            },
          ],
        },
        childFlag: {
          defaultValue: "default",
          rules: [
            {
              parentConditions: [
                {
                  id: "parentFlag",
                  condition: { $not: { value: "green" } },
                },
              ],
              force: null,
            },
            {
              condition: { memberType: "basic" },
              force: "success",
            },
          ],
        },
      },
    });

    const result = growthbook.evalFeature("childFlag");
    expect(result.value).toEqual(null);
    expect(result.source).toEqual("cyclicPrerequisite");

    growthbook.destroy();
  });
});
