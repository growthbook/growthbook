import { useFeatureIsOn } from "@growthbook/growthbook-react";
import {
  DataSourceInterfaceWithParams,
  GrowthbookClickhouseDataSourceWithParams,
} from "shared/types/datasource";

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

const EVENT_INGESTOR_HOSTS: Record<DataRegion, string> = {
  "us-east-1": "https://us1.gb-ingest.com",
  "eu-west-1": "https://eu-west-1.gb-ingest.com",
};

// The SDK's growthbookTrackingPlugin defaults to the us-east-1 host, so
// callers only need to pass this along explicitly for non-default regions.
export function getEventIngestorHost(region: DataRegion): string {
  return EVENT_INGESTOR_HOSTS[region];
}

// The org's events land in the same ingestor infrastructure whether they're
// destined for the Managed Warehouse (growthbook_clickhouse datasource) or
// forwarded to the org's own warehouse via the Event Forwarder.
export function getEventIngestorRegion(
  datasources: DataSourceInterfaceWithParams[],
): DataRegion | undefined {
  const managedWarehouse = datasources.find(
    (d): d is GrowthbookClickhouseDataSourceWithParams =>
      d.type === "growthbook_clickhouse",
  );
  if (managedWarehouse) {
    return managedWarehouse.settings?.region;
  }

  return datasources.find((d) => d.eventForwarderConfig)?.eventForwarderConfig
    ?.region;
}
