import { GrowthBook, GrowthBookClient } from "@growthbook/growthbook";

// Nothing registered: any feature key and any attributes are accepted
const gb = new GrowthBook({ attributes: { anything: 1 } });
gb.isOn("any-feature");
gb.setAttributes({ other: true });
gb.updateAttributes({ more: "x" });
export const value: string = gb.getFeatureValue("any-feature", "fallback");
// @ts-expect-error a fallback is required without a registered payload
gb.getFeatureValue("any-feature");
export const attribute: unknown = gb.getAttributes().anything;
gb.setPayload({ features: { whatever: { defaultValue: 1 } } });
new GrowthBookClient().isOn("any-feature", { attributes: { a: 1 } });
// Any event name and properties
gb.logEvent("any-event");
gb.logEvent("any-event", { anything: 1 });
new GrowthBookClient().logEvent("any-event", { anything: 1 }, {});
new GrowthBookClient().createScopedInstance({}).logEvent("any-event");

// Explicit generics still type a single instance
const typed = new GrowthBook<{ dark_mode: boolean }, { id: string }>();
typed.isOn("dark_mode");
// @ts-expect-error unknown feature
typed.isOn("nope");
// @ts-expect-error missing required attribute
typed.setAttributes({});
