import { Context, Experiment, GrowthBook } from "../src";

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
    });

    it("implements feature getting without types", () => {
      const growthbook = new GrowthBook(context);

      expect(growthbook.getFeatureValue("greeting", "??")).toEqual(
        "¡Bienvenidos y bienvenidas a Donas Acme!"
      );
      expect(growthbook.getFeatureValue("unknown_key", "??")).toEqual("??");
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
        "Bienvenue au Beignets Acme !"
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

  describe("run", () => {
    it("runs a typed experiment", () => {
      const context: Context = {
        features,
        attributes: {
          id: "user-abc123",
        },
      };

      const growthbook = new GrowthBook<TestAppFeatures>(context);

      const experiment: Experiment<string, "greeting"> = {
        key: "greeting",
        variations: ["bonjour", "hello", "good day", "how is your family"],
      };
      const experimentResult = growthbook.run(experiment);

      expect(experimentResult.value).toEqual("hello");
    });
  });

  it("runs an experiment without types", () => {
    const context: Context = {
      features,
      attributes: {
        id: "user-abc123",
      },
    };

    const growthbook = new GrowthBook(context);

    const experimentResult = growthbook.run({
      key: "greeting",
      variations: ["bonjour", "hello", "good day", "how is your family"],
    });

    expect(experimentResult.value).toEqual("hello");
  });
});
