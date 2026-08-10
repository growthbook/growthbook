import { useFeatureIsOn } from "@growthbook/growthbook-react";

export type DataRegion = "us-east-1" | "eu-west-1";

export const DATA_REGION_OPTIONS: { label: string; value: DataRegion }[] = [
  { label: "AWS us-east-1", value: "us-east-1" },
  { label: "AWS eu-west-1", value: "eu-west-1" },
];

export const DEFAULT_DATA_REGION: DataRegion = "us-east-1";

// The eu-west-1 option is gated behind the "eu-data-region" flag during rollout.
export function useDataRegionOptions(): { label: string; value: DataRegion }[] {
  const euRegionEnabled = useFeatureIsOn("eu-data-region");
  return euRegionEnabled
    ? DATA_REGION_OPTIONS
    : DATA_REGION_OPTIONS.filter((o) => o.value !== "eu-west-1");
}

export function getDataRegionLabel(region: DataRegion): string {
  return DATA_REGION_OPTIONS.find((o) => o.value === region)?.label ?? region;
}
