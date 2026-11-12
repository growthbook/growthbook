import { FeatureApiResponse, GrowthBook } from "@growthbook/growthbook";

// Not a FallbackPayload, so nothing says it has every feature
const payload: FeatureApiResponse = { features: {} };

declare module "@growthbook/growthbook" {
  interface Register {
    features: { banner: string };
    fallbackPayload: typeof payload;
  }
}

const gb = new GrowthBook().initSync({ payload });
// @ts-expect-error a fallback is still required
gb.getFeatureValue("banner");
export const banner: string = gb.getFeatureValue("banner", "control");
