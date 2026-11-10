import * as React from "react";
import {
  FeatureApiResponse,
  GrowthBook,
  GrowthBookProvider,
  useFeatureValue,
  useGrowthBook,
} from "@growthbook/growthbook-react";

// A payload written in code, registered in place of `features`
const payload = {
  features: {
    banner: { defaultValue: "control" },
    price: { defaultValue: 10 },
    no_default: { rules: [{ force: 1 }] },
  },
} satisfies FeatureApiResponse;

declare module "@growthbook/growthbook-react" {
  interface Register {
    payload: typeof payload;
  }
}

const gb = new GrowthBook().initSync({ payload });

export function Component() {
  // No fallback: the value type comes from each defaultValue
  const banner: string = useFeatureValue("banner");
  const price: number = useFeatureValue("price");
  const viaInstance: string = useGrowthBook().getFeatureValue("banner");
  const withFallback: number = useFeatureValue("no_default", 2);
  // @ts-expect-error unknown feature
  useFeatureValue("nope");
  // @ts-expect-error no defaultValue, so a fallback is still required
  useFeatureValue("no_default");
  // @ts-expect-error wrong fallback type
  useFeatureValue("price", "1");

  return (
    <GrowthBookProvider growthbook={gb}>
      {banner}
      {price}
      {viaInstance}
      {withFallback}
    </GrowthBookProvider>
  );
}
