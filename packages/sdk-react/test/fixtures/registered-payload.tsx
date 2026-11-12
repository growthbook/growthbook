import * as React from "react";
import {
  FallbackPayload,
  GrowthBook,
  GrowthBookProvider,
  useFeatureIsOn,
  useFeatureValue,
  useGrowthBook,
} from "@growthbook/growthbook-react";

// `satisfies` works as well as a type annotation
const fallbackPayload = {
  features: {
    banner: { defaultValue: "control" },
    price: { defaultValue: 10 },
    dark_mode: { defaultValue: true },
    nullable: { defaultValue: null },
  },
} satisfies FallbackPayload;

// Registering a fallback payload that has every feature
declare module "@growthbook/growthbook-react" {
  interface Register {
    features: {
      banner: string;
      price: number;
      dark_mode: boolean;
      nullable: number | null;
    };
    fallbackPayload: typeof fallbackPayload;
  }
}

const gb = new GrowthBook().initSync({ payload: fallbackPayload });

export function Component() {
  // No fallback: every feature has a default in the fallback payload
  const banner: string = useFeatureValue("banner");
  const price: number = useFeatureValue("price");
  const viaInstance: string = useGrowthBook().getFeatureValue("banner");
  const withFallback: number = useFeatureValue("nullable", 2);
  // @ts-expect-error unknown feature
  useFeatureValue("nope");
  // @ts-expect-error a feature that can be null still requires a fallback
  useFeatureValue("nullable");
  // @ts-expect-error a boolean feature still requires a fallback (or isOn)
  useFeatureValue("dark_mode");
  const darkMode: boolean = useFeatureIsOn("dark_mode");
  // @ts-expect-error wrong fallback type
  useFeatureValue("price", "1");

  return (
    <GrowthBookProvider growthbook={gb}>
      {banner}
      {price}
      {viaInstance}
      {withFallback}
      {String(darkMode)}
    </GrowthBookProvider>
  );
}
