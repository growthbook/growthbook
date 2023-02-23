import { Context, GrowthBook } from "../src";

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

  describe("getTypedFeatureValue", () => {
    const context: Context = {
      features,
      attributes: {
        id: "user-abc123",
        country: "mexico",
      },
    };

    it("implements type-safe feature getting", () => {
      const growthbook = new GrowthBook<TestAppFeatures>(context);

      const booleanResult = growthbook.getTypedFeatureValue("dark_mode", false);
      const jsonResult = growthbook.getTypedFeatureValue("sample_json", {});
      const stringResult = growthbook.getTypedFeatureValue("greeting", "??");

      expect(typeof booleanResult).toEqual("boolean");
      expect(booleanResult).toEqual(false);
      expect(typeof jsonResult).toEqual("object");
      expect(jsonResult).toEqual({ foo: "bar" });
      expect(typeof stringResult).toEqual("string");
      expect(stringResult).toEqual("¡Bienvenidos y bienvenidas a Donas Acme!");
    });
  });
});
