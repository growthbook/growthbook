import { EventForwarderSinkType } from "shared/types/event-forwarder";
import { DataRegion } from "./data-regions";
import { getEventForwarderWarehouseRegion } from "./event-forwarder-warehouse-region";

// Snowflake CURRENT_REGION() returns cloud-prefixed ids such as AWS_US_WEST_2,
// AZURE_WESTEUROPE, and GCP_US_CENTRAL1. Catalog ids drop the cloud and use
// the warehouse's own spelling.
export function warehouseRegionIdFromSnowflakeCurrentRegion(
  raw: string,
): string | null {
  let value = raw
    .trim()
    .replace(/^['"]|['"]$/g, "")
    .toUpperCase();
  if (value.startsWith("PUBLIC.")) value = value.slice("PUBLIC.".length);
  const match = /^(AWS|AZURE|GCP)_(.+)$/.exec(value);
  if (!match) return null;
  const rest = match[2].toLowerCase().replace(/_/g, "-");
  if (!rest || !/^[a-z0-9-]+$/.test(rest)) return null;
  return rest;
}

// Zerobus hosts are `<workspace>.zerobus.<region>.<cloud host>`. A workspace
// host does not include the region.
export function warehouseRegionIdFromDatabricksZerobusEndpoint(
  endpoint: string,
): string | null {
  const trimmed = endpoint.trim();
  if (!trimmed || trimmed.includes("<")) return null;
  let hostname: string;
  try {
    hostname = new URL(
      /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`,
    ).hostname.toLowerCase();
  } catch {
    return null;
  }
  const match =
    /(?:^|\.)zerobus\.([a-z0-9-]+)\.(?:cloud\.databricks\.com|gcp\.databricks\.com|azuredatabricks\.net)$/.exec(
      hostname,
    );
  const region = match?.[1];
  if (!region || region === "region") return null;
  return region;
}

// BigQuery dataset metadata uses US/EU for multi-region and lowercase ids
// such as us-west1 for a single region.
export function warehouseRegionIdFromBigQueryLocation(
  raw: string,
): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const upper = trimmed.toUpperCase();
  if (upper === "US" || upper === "EU") return upper;
  const id = trimmed.toLowerCase();
  if (!/^[a-z0-9-]+$/.test(id)) return null;
  return id;
}

export function resolveDetectedEventForwarderRegion(
  sinkType: EventForwarderSinkType,
  warehouseRegionId: string | null,
): { warehouseRegionId: string; growthBookRegion: DataRegion } | null {
  if (!warehouseRegionId) return null;
  const region = getEventForwarderWarehouseRegion(sinkType, warehouseRegionId);
  if (!region) return null;
  return {
    warehouseRegionId: region.id,
    growthBookRegion: region.growthBookRegion,
  };
}
