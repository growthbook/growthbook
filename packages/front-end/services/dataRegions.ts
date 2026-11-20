import { useFeatureIsOn } from "@growthbook/growthbook-react";
import type { DataRegion } from "shared/util";
import { useDefinitions } from "@/services/DefinitionsContext";

export type { DataRegion };

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

// Data regions with an Event Forwarder that receives the environment
// ("" in a claim is all environments)
export function eventForwarderRegionsFor(
  claims: { environment: string; region: DataRegion }[],
  environment?: string,
): DataRegion[] {
  return [
    ...new Set(
      claims
        .filter((e) => !e.environment || e.environment === environment)
        .map((e) => e.region),
    ),
  ];
}

// Ingestor region for an SDK Connection's setup snippets
// - Follows the Event Forwarder that receives the connection's environment
// - Forwarders in both regions receive it: undefined, so the SDK default host
// - No forwarder for the environment: the org's region
export function eventIngestorRegionFor(
  regions: DataRegion[],
  orgRegion: DataRegion | undefined,
): DataRegion | undefined {
  if (regions.length > 1) return undefined;
  return regions[0] ?? orgRegion;
}

// Empty with a Managed Warehouse, which uses the org's region instead
export function useEventForwarderRegions(environment?: string): DataRegion[] {
  const { hasManagedWarehouse, eventForwarderEnvironments } = useDefinitions();
  if (hasManagedWarehouse) return [];
  return eventForwarderRegionsFor(eventForwarderEnvironments, environment);
}

export function useEventIngestorRegion(
  environment?: string,
): DataRegion | undefined {
  const { eventIngestorRegion } = useDefinitions();
  return eventIngestorRegionFor(
    useEventForwarderRegions(environment),
    eventIngestorRegion,
  );
}
