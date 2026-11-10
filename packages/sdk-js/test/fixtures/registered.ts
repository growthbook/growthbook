import { GrowthBook, GrowthBookClient } from "@growthbook/growthbook";

declare module "@growthbook/growthbook" {
  interface Register {
    features: { dark_mode: boolean; price: number };
    attributes: { id: string; plan?: "free" | "pro" };
  }
}

// No generics: instances pick up the registered types
const gb = new GrowthBook({ attributes: { id: "1" } });
export const price: number = gb.getFeatureValue("price", 1);
gb.setAttributes({ id: "1", plan: "pro" });
gb.updateAttributes({ plan: "free" });
// @ts-expect-error unknown feature
gb.isOn("dark_mod");
// @ts-expect-error wrong fallback type
gb.getFeatureValue("price", "1");
// @ts-expect-error missing required attribute
gb.setAttributes({ plan: "pro" });
// @ts-expect-error unknown attribute
gb.updateAttributes({ nope: 1 });
// @ts-expect-error invalid value
gb.updateAttributes({ plan: "enterprise" });
// @ts-expect-error attributes may not be set yet
export const id: string = gb.getAttributes().id;
// @ts-expect-error unknown feature in a payload written in code
gb.setPayload({ features: { nope: { defaultValue: 1 } } });

const client = new GrowthBookClient();
client.isOn("dark_mode", { attributes: { id: "1" } });
// @ts-expect-error unknown feature
client.isOn("nope", { attributes: { id: "1" } });
// @ts-expect-error missing required attribute
client.isOn("dark_mode", { attributes: {} });

// Explicit generics override the registered types for one instance
const other = new GrowthBook<{ other_flag: boolean }, { id: number }>({
  // Callbacks are not tied to the registered attributes (where id is a string)
  trackingCallback: (experiment, result, user) => {
    const userId: number = user?.attributes?.id;
    void userId;
  },
});
other.isOn("other_flag");
other.setAttributes({ id: 1 });
// @ts-expect-error a registered feature is not on this instance
other.isOn("dark_mode");
// @ts-expect-error this instance's id is a number
other.setAttributes({ id: "1" });
