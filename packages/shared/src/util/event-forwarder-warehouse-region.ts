import { EventForwarderSinkType } from "shared/types/event-forwarder";
import { DataRegion } from "./data-regions";

export const EVENT_FORWARDER_WAREHOUSE_AREAS = [
  "Multi-region",
  "United States",
  "Canada",
  "Mexico",
  "South America",
  "Europe",
  "Asia Pacific",
  "India",
  "Middle East",
  "Africa",
] as const;

export type EventForwarderWarehouseArea =
  (typeof EVENT_FORWARDER_WAREHOUSE_AREAS)[number];

export type EventForwarderWarehouseCloud = "AWS" | "Azure" | "GCP";

// A location the warehouse already uses. `growthBookRegion` is where
// GrowthBook processes events on the way there. Americas map to us-east-1.
// Europe, India, the Middle East, and Africa map to eu-west-1. Asia Pacific
// maps to us-east-1 until a closer processing region exists.
export type EventForwarderWarehouseRegion = {
  id: string;
  label: string;
  cloud: EventForwarderWarehouseCloud;
  area: EventForwarderWarehouseArea;
  growthBookRegion: DataRegion;
};

const US: DataRegion = "us-east-1";
const EU: DataRegion = "eu-west-1";

function regions(
  cloud: EventForwarderWarehouseCloud,
  area: EventForwarderWarehouseArea,
  growthBookRegion: DataRegion,
  ids: readonly string[],
): EventForwarderWarehouseRegion[] {
  return ids.map((id) => ({
    id,
    label: id,
    cloud,
    area,
    growthBookRegion,
  }));
}

const BIGQUERY_REGIONS: EventForwarderWarehouseRegion[] = [
  {
    id: "US",
    label: "US (multi-region)",
    cloud: "GCP",
    area: "Multi-region",
    growthBookRegion: US,
  },
  {
    id: "EU",
    label: "EU (multi-region)",
    cloud: "GCP",
    area: "Multi-region",
    growthBookRegion: EU,
  },
  ...regions("GCP", "United States", US, [
    "us-east1",
    "us-east4",
    "us-east5",
    "us-central1",
    "us-south1",
    "us-west1",
    "us-west2",
    "us-west3",
    "us-west4",
  ]),
  ...regions("GCP", "Canada", US, [
    "northamerica-northeast1",
    "northamerica-northeast2",
  ]),
  ...regions("GCP", "Mexico", US, ["northamerica-south1"]),
  ...regions("GCP", "South America", US, [
    "southamerica-east1",
    "southamerica-west1",
  ]),
  ...regions("GCP", "Europe", EU, [
    "europe-central2",
    "europe-north1",
    "europe-southwest1",
    "europe-west1",
    "europe-west2",
    "europe-west3",
    "europe-west4",
    "europe-west6",
    "europe-west8",
    "europe-west9",
    "europe-west10",
    "europe-west12",
  ]),
  ...regions("GCP", "Asia Pacific", US, [
    "asia-east1",
    "asia-east2",
    "asia-northeast1",
    "asia-northeast2",
    "asia-northeast3",
    "asia-southeast1",
    "asia-southeast2",
    "australia-southeast1",
    "australia-southeast2",
  ]),
  ...regions("GCP", "India", EU, ["asia-south1", "asia-south2"]),
  ...regions("GCP", "Middle East", EU, [
    "me-central1",
    "me-central2",
    "me-west1",
  ]),
  ...regions("GCP", "Africa", EU, ["africa-south1"]),
];

const SNOWFLAKE_REGIONS: EventForwarderWarehouseRegion[] = [
  ...regions("AWS", "United States", US, [
    "us-east-1",
    "us-east-2",
    "us-west-2",
  ]),
  ...regions("AWS", "Canada", US, ["ca-central-1"]),
  ...regions("AWS", "South America", US, ["sa-east-1"]),
  ...regions("AWS", "Europe", EU, [
    "eu-west-1",
    "eu-west-2",
    "eu-west-3",
    "eu-central-1",
    "eu-central-2",
    "eu-north-1",
  ]),
  ...regions("AWS", "Asia Pacific", US, [
    "ap-northeast-1",
    "ap-northeast-2",
    "ap-northeast-3",
    "ap-southeast-1",
    "ap-southeast-2",
    "ap-southeast-3",
  ]),
  ...regions("AWS", "India", EU, ["ap-south-1"]),
  ...regions("Azure", "United States", US, [
    "eastus2",
    "centralus",
    "southcentralus",
    "westus2",
  ]),
  ...regions("Azure", "Canada", US, ["canadacentral"]),
  ...regions("Azure", "Europe", EU, [
    "westeurope",
    "northeurope",
    "uksouth",
    "switzerlandnorth",
    "germanywestcentral",
  ]),
  ...regions("Azure", "Middle East", EU, ["uaenorth"]),
  ...regions("Azure", "Asia Pacific", US, [
    "southeastasia",
    "australiaeast",
    "japaneast",
  ]),
  ...regions("Azure", "India", EU, ["centralindia"]),
  ...regions("GCP", "United States", US, ["us-central1", "us-east4"]),
  ...regions("GCP", "Europe", EU, ["europe-west2", "europe-west4"]),
];

const DATABRICKS_REGIONS: EventForwarderWarehouseRegion[] = [
  ...regions("AWS", "United States", US, [
    "us-east-1",
    "us-east-2",
    "us-west-1",
    "us-west-2",
  ]),
  ...regions("AWS", "Canada", US, ["ca-central-1"]),
  ...regions("AWS", "South America", US, ["sa-east-1"]),
  ...regions("AWS", "Europe", EU, [
    "eu-west-1",
    "eu-west-2",
    "eu-west-3",
    "eu-central-1",
    "eu-north-1",
  ]),
  ...regions("AWS", "Asia Pacific", US, [
    "ap-northeast-1",
    "ap-northeast-2",
    "ap-southeast-1",
    "ap-southeast-2",
    "ap-southeast-3",
  ]),
  ...regions("AWS", "India", EU, ["ap-south-1"]),
  ...regions("Azure", "United States", US, [
    "eastus",
    "eastus2",
    "centralus",
    "northcentralus",
    "southcentralus",
    "westus",
    "westus2",
    "westus3",
  ]),
  ...regions("Azure", "Canada", US, ["canadacentral"]),
  ...regions("Azure", "Mexico", US, ["mexicocentral"]),
  ...regions("Azure", "South America", US, ["brazilsouth"]),
  ...regions("Azure", "Europe", EU, [
    "northeurope",
    "westeurope",
    "uksouth",
    "francecentral",
    "germanywestcentral",
    "switzerlandnorth",
    "norwayeast",
    "swedencentral",
    "polandcentral",
  ]),
  ...regions("Azure", "Middle East", EU, ["uaenorth"]),
  ...regions("Azure", "Africa", EU, ["southafricanorth"]),
  ...regions("Azure", "Asia Pacific", US, [
    "southeastasia",
    "eastasia",
    "australiaeast",
    "japaneast",
    "koreacentral",
  ]),
  ...regions("Azure", "India", EU, ["centralindia"]),
  ...regions("GCP", "United States", US, [
    "us-central1",
    "us-east1",
    "us-east4",
    "us-west1",
    "us-west4",
  ]),
  ...regions("GCP", "Canada", US, ["northamerica-northeast1"]),
  ...regions("GCP", "Europe", EU, [
    "europe-west1",
    "europe-west2",
    "europe-west3",
  ]),
  ...regions("GCP", "Asia Pacific", US, [
    "asia-southeast1",
    "asia-northeast1",
    "australia-southeast1",
  ]),
  ...regions("GCP", "India", EU, ["asia-south1"]),
];

const WAREHOUSE_REGIONS: Record<
  EventForwarderSinkType,
  readonly EventForwarderWarehouseRegion[]
> = {
  bigquery: BIGQUERY_REGIONS,
  snowflake: SNOWFLAKE_REGIONS,
  databricks: DATABRICKS_REGIONS,
};

export function listEventForwarderWarehouseRegions(
  sinkType: EventForwarderSinkType,
): readonly EventForwarderWarehouseRegion[] {
  return WAREHOUSE_REGIONS[sinkType];
}

export function getEventForwarderWarehouseRegion(
  sinkType: EventForwarderSinkType,
  id: string,
): EventForwarderWarehouseRegion | null {
  return WAREHOUSE_REGIONS[sinkType].find((region) => region.id === id) ?? null;
}

export function getGrowthBookRegionForWarehouseRegion(
  sinkType: EventForwarderSinkType,
  id: string,
): DataRegion | null {
  return (
    getEventForwarderWarehouseRegion(sinkType, id)?.growthBookRegion ?? null
  );
}
