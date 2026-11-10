import {
  FeatureApiResponse,
  GrowthBook,
  GrowthBookClient,
} from "@growthbook/growthbook";

// A payload written in code, registered in place of `features`
const payload = {
  features: {
    banner: { defaultValue: "control" },
    dark_mode: {
      defaultValue: false,
      rules: [{ condition: { beta: true }, force: true, range: [0, 0.5] }],
    },
    config: { defaultValue: { size: 10, color: "blue" } },
    variant: { defaultValue: "a" as "a" | "b" },
    no_default: { rules: [{ force: 1 }] },
    nullable: { defaultValue: null as string | null },
  },
} satisfies FeatureApiResponse;

declare module "@growthbook/growthbook" {
  interface Register {
    payload: typeof payload;
  }
}

// No fallback: the value type comes from each defaultValue
const gb = new GrowthBook().initSync({ payload });
export const banner: string = gb.getFeatureValue("banner");
export const darkMode: boolean = gb.getFeatureValue("dark_mode");
export const config: { size: number; color: string } =
  gb.getFeatureValue("config");
export const variant: "a" | "b" = gb.getFeatureValue("variant");
// @ts-expect-error a string default is typed as string, not its literal
export const literal: "control" = gb.getFeatureValue("banner");
// @ts-expect-error unknown feature
gb.getFeatureValue("nope");
// @ts-expect-error no defaultValue, so a fallback is still required
gb.getFeatureValue("no_default");
// @ts-expect-error a nullable defaultValue still requires a fallback
gb.getFeatureValue("nullable");

// A fallback still works, and is checked against the feature's type
export const withFallback: string = gb.getFeatureValue("banner", "other");
export const nullable: string = gb.getFeatureValue("nullable", "x");
export const noDefault: number = gb.getFeatureValue("no_default", 2);
// @ts-expect-error wrong fallback type
gb.getFeatureValue("banner", 1);
gb.isOn("dark_mode");
// @ts-expect-error unknown feature
gb.isOn("nope");
export const evaluated: string | null = gb.evalFeature("banner").value;

const client = new GrowthBookClient().initSync({ payload });
export const clientBanner: string = client.getFeatureValue("banner", {});
export const scopedBanner: string = client
  .createScopedInstance({})
  .getFeatureValue("banner");
// @ts-expect-error no defaultValue, so a fallback is still required
client.getFeatureValue("no_default", {});
export const clientFallback: number = client.getFeatureValue(
  "no_default",
  2,
  {},
);

// An instance with its own generics doesn't use the registered payload
const other = new GrowthBook<{ other_flag: boolean }>();
// @ts-expect-error not a feature in the registered payload
other.getFeatureValue("other_flag");
other.getFeatureValue("other_flag", false);
