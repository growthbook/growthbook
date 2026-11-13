import * as React from "react";
import {
  GrowthBook,
  GrowthBookProvider,
  IfFeatureEnabled,
  useFeature,
  useFeatureIsOn,
  useFeatureValue,
  useGrowthBook,
} from "@growthbook/growthbook-react";

// A React-only install registers through the React package
declare module "@growthbook/growthbook-react" {
  interface Register {
    features: { dark_mode: boolean; price: number };
    attributes: { id: string };
    events: { button_click: { button: string } };
  }
}

const gb = new GrowthBook({ attributes: { id: "1" } });
const other = new GrowthBook<{ other_flag: boolean }, { org: string }>();

export function Component() {
  // No generics: hooks pick up the registered types
  const price: number = useFeatureValue("price", 1);
  const on: boolean = useFeatureIsOn("dark_mode");
  const value: number | null = useFeature("price").value;
  // @ts-expect-error unknown feature
  useFeatureIsOn("dark_mod");
  // @ts-expect-error wrong fallback type
  useFeatureValue("price", "1");
  // A null fallback is allowed, and the result can then be null
  const orNull: number | null = useFeatureValue("price", null);
  // @ts-expect-error the result can be null
  const notNull: number = useFeatureValue("price", null);
  // @ts-expect-error unknown feature
  useFeature("nope");
  // @ts-expect-error missing required attribute
  useGrowthBook().setAttributes({});
  useGrowthBook().logEvent("button_click", { button: "signup" });
  // @ts-expect-error unknown event
  useGrowthBook().logEvent("button_clik", { button: "signup" });
  // @ts-expect-error missing required properties
  useGrowthBook().logEvent("button_click");

  // Explicit generics still type a single call
  useGrowthBook<{ other_flag: boolean }>().isOn("other_flag");
  // @ts-expect-error a registered feature is not in these types
  useGrowthBook<{ other_flag: boolean }>().isOn("dark_mode");

  return (
    <GrowthBookProvider growthbook={gb}>
      {/* The provider accepts an instance typed with its own generics */}
      <GrowthBookProvider growthbook={other}>
        <IfFeatureEnabled feature="dark_mode">
          {price}
          {String(on)}
          {value}
          {orNull}
          {notNull}
        </IfFeatureEnabled>
        {/* @ts-expect-error unknown feature */}
        <IfFeatureEnabled feature="nope">x</IfFeatureEnabled>
      </GrowthBookProvider>
    </GrowthBookProvider>
  );
}
