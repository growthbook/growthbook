import {
  Context,
  FeatureApiResponse,
  GrowthBook,
  GrowthBookClient,
} from "../src";

type TestAppFeatures = {
  dark_mode: boolean;
  sample_json: Record<string, unknown>;
  greeting: string;
};

describe("typed features", () => {
  const features = {
    dark_mode: {
      defaultValue: false,
      rules: [
        {
          condition: {
            id: "foo",
          },
          force: true,
          coverage: 0.5,
          hashAttribute: "id",
        },
      ],
    },
    sample_json: {
      defaultValue: {
        foo: "bar",
      },
    },
    greeting: {
      defaultValue: "Welcome to Acme Donuts!",
      rules: [
        {
          condition: {
            country: "france",
          },
          force: "Bienvenue au Beignets Acme !",
        },
        {
          condition: {
            country: "mexico",
          },
          force: "¡Bienvenidos y bienvenidas a Donas Acme!",
        },
      ],
    },
  };

  describe("getFeatureValue", () => {
    const context: Context = {
      features,
      attributes: {
        id: "user-abc123",
        country: "mexico",
      },
    };

    it("implements type-safe feature getting", () => {
      const growthbook = new GrowthBook<TestAppFeatures>(context);

      const booleanResult = growthbook.getFeatureValue("dark_mode", false);
      const jsonResult = growthbook.getFeatureValue("sample_json", {});
      const stringResult = growthbook.getFeatureValue("greeting", "??");

      expect(typeof booleanResult).toEqual("boolean");
      expect(booleanResult).toEqual(false);
      expect(typeof jsonResult).toEqual("object");
      expect(jsonResult).toEqual({ foo: "bar" });
      expect(typeof stringResult).toEqual("string");
      expect(stringResult).toEqual("¡Bienvenidos y bienvenidas a Donas Acme!");
      expect(growthbook.isOn("greeting")).toEqual(true);
      expect(growthbook.isOff("greeting")).toEqual(false);
    });

    it("implements feature getting without types", () => {
      const growthbook = new GrowthBook(context);

      expect(growthbook.getFeatureValue("greeting", "??")).toEqual(
        "¡Bienvenidos y bienvenidas a Donas Acme!",
      );
      expect(growthbook.getFeatureValue<string>("greeting", "??")).toEqual(
        "¡Bienvenidos y bienvenidas a Donas Acme!",
      );
      expect(growthbook.getFeatureValue("unknown_key", "??")).toEqual("??");
      expect(growthbook.isOn("unknown_key")).toEqual(false);
      expect(growthbook.isOff("unknown_key")).toEqual(true);
    });
  });

  describe("getFeatureValue without a fallback", () => {
    // Only type-checks against a registered payload (see
    // fixtures/registered-payload.ts), so these calls are untyped
    const getValue = (gb: unknown, ...args: unknown[]) =>
      (gb as { getFeatureValue: (...a: unknown[]) => unknown }).getFeatureValue(
        ...args,
      );
    const bundled: FeatureApiResponse = {
      features: {
        banner: {
          defaultValue: "control",
          rules: [{ condition: { country: "france" }, force: "bonjour" }],
        },
        gated: {
          defaultValue: "on",
          rules: [
            {
              parentConditions: [
                { id: "parent", condition: { value: true }, gate: true },
              ],
            },
          ],
        },
        parent: { defaultValue: false },
        no_default: {},
      },
    };
    const remote: FeatureApiResponse = {
      features: { banner: { defaultValue: "remote" } },
    };

    it("uses the default of a feature that evaluates to null", () => {
      const gb = new GrowthBook().initSync({ payload: bundled });
      expect(getValue(gb, "banner")).toEqual("control");
      // Blocked by a prerequisite, so the value is null
      expect(gb.evalFeature("gated").value).toEqual(null);
      expect(getValue(gb, "gated")).toEqual("on");
      expect(getValue(gb, "gated", "fallback")).toEqual("fallback");
      // A fallback that is passed in is used, even `undefined`
      expect(getValue(gb, "gated", undefined)).toEqual(undefined);
      expect(getValue(gb, "no_default")).toEqual(undefined);
      expect(getValue(gb, "unknown_key")).toEqual(undefined);

      gb.setAttributes({ country: "france" });
      expect(getValue(gb, "banner")).toEqual("bonjour");
    });

    it("uses the fallbackPayload's default for a feature the payload omits", async () => {
      const gb = new GrowthBook();
      await gb.init({ payload: remote, fallbackPayload: bundled });
      expect(getValue(gb, "banner")).toEqual("remote");
      expect(getValue(gb, "gated")).toEqual("on");
      expect(getValue(gb, "gated", "fallback")).toEqual("fallback");
      expect(getValue(gb, "gated", undefined)).toEqual(undefined);

      // The current payload's default wins when it has one
      await gb.setPayload({
        features: {
          gated: { ...bundled.features?.gated, defaultValue: "remote-on" },
        },
      });
      expect(gb.evalFeature("gated").value).toEqual(null);
      expect(getValue(gb, "gated")).toEqual("remote-on");
      expect(getValue(gb, "banner")).toEqual("control");
      gb.destroy();

      // Without a fallbackPayload there is nothing to use
      const gb2 = new GrowthBook().initSync({ payload: remote });
      expect(getValue(gb2, "gated")).toEqual(undefined);
    });

    it("works with GrowthBookClient and scoped instances", async () => {
      const user = { attributes: { country: "france" } };
      const client = new GrowthBookClient().initSync({ payload: bundled });
      expect(getValue(client, "banner", user)).toEqual("bonjour");
      expect(getValue(client, "gated", {})).toEqual("on");
      expect(client.getFeatureValue("gated", "fallback", {})).toEqual(
        "fallback",
      );
      const scoped = client.createScopedInstance({});
      expect(getValue(scoped, "banner")).toEqual("control");
      expect(getValue(scoped, "gated")).toEqual("on");
      expect(getValue(scoped, "gated", "fallback")).toEqual("fallback");
      // A fallback that is passed in is used, even `undefined`
      expect(getValue(client, "gated", undefined, {})).toEqual(undefined);
      expect(getValue(scoped, "gated", undefined)).toEqual(undefined);

      const client2 = new GrowthBookClient();
      await client2.init({ payload: remote, fallbackPayload: bundled });
      expect(getValue(client2, "banner", user)).toEqual("remote");
      expect(getValue(client2, "gated", {})).toEqual("on");
      expect(getValue(client2.createScopedInstance(user), "gated")).toEqual(
        "on",
      );
      client2.destroy();
    });
  });

  describe("evalFeature", () => {
    const context: Context = {
      features,
      attributes: {
        id: "user-abc123",
        country: "france",
      },
    };

    it("evaluates a feature without using types", () => {
      const growthbook = new GrowthBook(context);

      expect(growthbook.evalFeature("greeting").value).toEqual(
        "Bienvenue au Beignets Acme !",
      );
      expect(growthbook.evalFeature("unknown_key").value).toEqual(null);
    });

    it("evaluates a typed feature", () => {
      const growthbook = new GrowthBook<TestAppFeatures>(context);

      const result = growthbook.evalFeature("greeting");

      expect(result.on).toEqual(true);
      expect(result.value).toEqual("Bienvenue au Beignets Acme !");
    });
  });

  describe("feature (alias for evalFeature(key))", () => {
    const context: Context = {
      features,
      attributes: {
        id: "user-abc123",
        country: "france",
      },
    };

    it("evaluates a feature without using types", () => {
      const growthbook = new GrowthBook(context);

      expect(growthbook.feature("greeting").value).toEqual(
        "Bienvenue au Beignets Acme !",
      );
      expect(growthbook.feature("unknown_key").value).toEqual(null);
    });

    it("evaluates a typed feature", () => {
      const growthbook = new GrowthBook<TestAppFeatures>(context);

      const result = growthbook.feature("greeting");

      expect(result.on).toEqual(true);
      expect(result.value).toEqual("Bienvenue au Beignets Acme !");
    });
  });

  describe("typed attributes", () => {
    type TestAttributes = { id: string; country?: string };

    it("type-checks attributes", async () => {
      const growthbook = new GrowthBook<TestAppFeatures, TestAttributes>({
        features,
        attributes: { id: "user-abc123" },
      });

      await growthbook.setAttributes({ id: "user-abc123", country: "france" });
      // @ts-expect-error missing required attribute
      await growthbook.setAttributes({ country: "mexico" });
      // @ts-expect-error unknown attribute
      await growthbook.updateAttributes({ plan: "pro" });
      await growthbook.updateAttributes({ country: "mexico" });

      const country: string | undefined = growthbook.getAttributes().country;
      expect(country).toEqual("mexico");
      expect(growthbook.getFeatureValue("greeting", "??")).toEqual(
        "¡Bienvenidos y bienvenidas a Donas Acme!",
      );

      // Untyped instances accept any attributes
      await new GrowthBook({ attributes: { id: 1 } }).setAttributes({ a: 1 });
    });
  });

  describe("typed payloads", () => {
    it("type-checks payloads written in code", async () => {
      const growthbook = new GrowthBook<TestAppFeatures>();

      // Features can be left out, and the chained instance stays typed
      const greeting: string = growthbook
        .initSync({ payload: { features: { greeting: features.greeting } } })
        .getFeatureValue("greeting", "??");
      expect(greeting).toEqual("Welcome to Acme Donuts!");

      await growthbook.setPayload({
        // @ts-expect-error wrong value type
        features: { dark_mode: { defaultValue: "yes" } },
      });
      await growthbook.setPayload({
        // @ts-expect-error wrong value type in a rule
        features: { greeting: { defaultValue: "hi", rules: [{ force: 1 }] } },
      });
      await growthbook.init({
        // @ts-expect-error unknown feature
        payload: { features: { not_a_flag: { defaultValue: 1 } } },
      });

      // A payload from the API or another instance is not checked
      const fromApi: FeatureApiResponse = { features };
      await growthbook.setPayload(fromApi);
      await growthbook.setPayload(new GrowthBook({ features }).getPayload());
      expect(growthbook.isOn("greeting")).toEqual(true);

      // Untyped instances accept anything
      new GrowthBook().initSync({
        payload: { features: { anything: { defaultValue: 1 } } },
      });
      new GrowthBookClient<TestAppFeatures>().initSync({
        // @ts-expect-error unknown feature
        payload: { features: { not_a_flag: { defaultValue: 1 } } },
      });
    });
  });
});
