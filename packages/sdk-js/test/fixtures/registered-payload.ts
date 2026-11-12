import {
  FallbackPayload,
  GrowthBook,
  GrowthBookClient,
} from "@growthbook/growthbook";

type AppFeatures = {
  banner: string;
  dark_mode: boolean;
  config: { size: number; color: string };
  variant: "a" | "b";
  nullable: string | null;
};

// Checked against the registered features and attributes
const fallbackPayload: FallbackPayload = {
  features: {
    banner: { defaultValue: "control" },
    dark_mode: {
      defaultValue: false,
      rules: [{ condition: { beta: true }, force: true, range: [0, 0.5] }],
    },
    config: { defaultValue: { size: 10, color: "blue" } },
    variant: { defaultValue: "a" },
    nullable: { defaultValue: null },
  },
};

// Registering a fallback payload that has every feature
declare module "@growthbook/growthbook" {
  interface Register {
    features: AppFeatures;
    attributes: { beta?: boolean };
    fallbackPayload: typeof fallbackPayload;
  }
}

// No fallback: every feature has a default in the fallback payload
const gb = new GrowthBook();
gb.init({ fallbackPayload });
export const banner: string = gb.getFeatureValue("banner");
// @ts-expect-error a boolean feature still requires a fallback (or isOn)
gb.getFeatureValue("dark_mode");
export const darkMode: boolean = gb.getFeatureValue("dark_mode", false);
export const config: { size: number; color: string } =
  gb.getFeatureValue("config");
export const variant: "a" | "b" = gb.getFeatureValue("variant");
// @ts-expect-error unknown feature
gb.getFeatureValue("nope");
// @ts-expect-error a feature that can be null still requires a fallback
gb.getFeatureValue("nullable");

// A fallback still works, and is checked against the feature's type
export const withFallback: string = gb.getFeatureValue("banner", "other");
export const nullable: string = gb.getFeatureValue("nullable", "x");
// @ts-expect-error wrong fallback type
gb.getFeatureValue("banner", 1);
gb.isOn("dark_mode");
// @ts-expect-error unknown feature
gb.isOn("nope");
export const evaluated: string | null = gb.evalFeature("banner").value;

const client = new GrowthBookClient().initSync({ payload: fallbackPayload });
export const clientBanner: string = client.getFeatureValue("banner", {});
export const scopedBanner: string = client
  .createScopedInstance({})
  .getFeatureValue("banner");
// @ts-expect-error a feature that can be null still requires a fallback
client.getFeatureValue("nullable", {});
export const clientFallback: string = client.getFeatureValue(
  "nullable",
  "x",
  {},
);

// An instance with its own generics doesn't use the registered fallback
const other = new GrowthBook<{ other_flag: boolean; price: number }>();
// @ts-expect-error not a registered feature
other.getFeatureValue("price");
other.getFeatureValue("price", 1);
