import { GrowthBook, GrowthBookClient } from "@growthbook/growthbook";

declare module "@growthbook/growthbook" {
  interface Register {
    features: { dark_mode: boolean; price: number };
    attributes: { id: string; plan?: "free" | "pro" };
    events: {
      start_checkout: { plan: "pro" | "enterprise" };
      button_click: { button: string; label?: string };
      page_view: { path?: string };
    };
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

// Event names and properties are checked against the registered events
gb.logEvent("start_checkout", { plan: "pro" });
gb.logEvent("button_click", { button: "signup", label: "Sign up" });
// Properties can be left out when none are required
gb.logEvent("page_view");
gb.logEvent("page_view", { path: "/" });
// @ts-expect-error unknown event
gb.logEvent("start_checkuot", { plan: "pro" });
// @ts-expect-error invalid property value
gb.logEvent("start_checkout", { plan: "free" });
// @ts-expect-error missing required properties
gb.logEvent("start_checkout");
// @ts-expect-error missing required property
gb.logEvent("button_click", {});
// @ts-expect-error unknown property
gb.logEvent("button_click", { button: "signup", color: "blue" });

const client = new GrowthBookClient();
client.logEvent("start_checkout", { plan: "pro" }, { attributes: { id: "1" } });
client.logEvent("page_view", {}, { attributes: { id: "1" } });
// @ts-expect-error unknown event
client.logEvent("nope", {}, { attributes: { id: "1" } });
// @ts-expect-error invalid property value
client.logEvent("start_checkout", { plan: 1 }, { attributes: { id: "1" } });
const scoped = client.createScopedInstance({ attributes: { id: "1" } });
scoped.logEvent("button_click", { button: "signup" });
scoped.logEvent("page_view");
// @ts-expect-error unknown event
scoped.logEvent("nope");
// @ts-expect-error missing required properties
scoped.logEvent("button_click");
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
