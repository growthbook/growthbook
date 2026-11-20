import {
  GrowthBook,
  GrowthBookClient,
  LocalFeatures,
} from "@growthbook/growthbook";

type AppFeatures = {
  newCheckout: boolean;
  uploadLimitMb: number;
  // An optional feature can be left out of the local features
  banner?: string;
};
type AppAttributes = { id: string; plan: "free" | "pro"; beta: boolean };

declare module "@growthbook/growthbook" {
  interface Register {
    features: AppFeatures;
    attributes: AppAttributes;
  }
}

const features: LocalFeatures = {
  newCheckout: {
    defaultValue: false,
    rules: [
      { condition: { beta: true }, force: true },
      { force: true, coverage: 0.2, hashAttribute: "id" },
      { force: true, coverage: 0.5, hashAttribute: "id", seed: "checkout" },
    ],
  },
  uploadLimitMb: {
    defaultValue: 10,
    rules: [{ condition: { plan: "pro" }, force: 20 }],
  },
};

// Accepted as a payload's features
const gb = new GrowthBook({
  attributes: { id: "1", plan: "free", beta: false },
}).initSync({ payload: { features } });
// A feature that was left out reads as the fallback
const banner: string = gb.getFeatureValue("banner", "none");
new GrowthBookClient().initSync({ payload: { features } });

// @ts-expect-error every registered feature must be defined
const missing: LocalFeatures = { newCheckout: { defaultValue: false } };

const bad: LocalFeatures = {
  // @ts-expect-error defaultValue is required
  newCheckout: {},
  // @ts-expect-error an optional feature still needs a real defaultValue
  banner: { defaultValue: undefined },
  uploadLimitMb: {
    defaultValue: 10,
    rules: [
      // @ts-expect-error coverage needs a hashAttribute
      { force: 20, coverage: 0.2 },
      // @ts-expect-error hashAttribute must be a string or number attribute
      { force: 20, coverage: 0.2, hashAttribute: "beta" },
      // @ts-expect-error seed only applies to a rollout
      { force: 20, seed: "checkout" },
      // @ts-expect-error force is required
      { condition: { plan: "pro" } },
      // @ts-expect-error the flag is a number
      { force: "20" },
      // @ts-expect-error not one of the plans
      { condition: { plan: "premium" }, force: 20 },
      // @ts-expect-error payload-only rule fields aren't allowed
      { force: 20, variations: [1, 2] },
    ],
  },
};

const extra: LocalFeatures = {
  newCheckout: { defaultValue: false },
  uploadLimitMb: { defaultValue: 10 },
  banner: { defaultValue: "hi", rules: [{ force: "hello" }] },
  // @ts-expect-error not a registered feature
  oldCheckout: { defaultValue: false },
};

export { missing, bad, extra, banner };
