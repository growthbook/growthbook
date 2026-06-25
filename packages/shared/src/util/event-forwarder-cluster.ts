// Derives the cloud + region of a datasource's warehouse so the Event Forwarder
// can route it to a co-located Confluent cluster (the license server maps
// {cloud, region} -> Kafka cluster credentials). Region values are normalized to
// the cloud provider's own region codes (aws "us-east-1", gcp "us-central1",
// azure "eastus2"), matching how Confluent identifies cluster regions.

export type EventForwarderCloud = "aws" | "gcp" | "azure";

export type EventForwarderCloudRegion = {
  cloud: EventForwarderCloud;
  region: string;
};

const SNOWFLAKE_HOST_SUFFIX = ".snowflakecomputing.com";
const CLOUD_TOKENS: readonly EventForwarderCloud[] = ["aws", "gcp", "azure"];

/** Per-cloud region-string normalization to the provider's native code. */
function normalizeRegionForCloud(
  cloud: EventForwarderCloud,
  raw: string,
): string {
  const lower = raw.trim().toLowerCase();
  // Azure region codes have no separators (e.g. "eastus2", "westeurope"), but
  // sources spell them with dashes or underscores ("west-us-2", "WESTUS2").
  // AWS/GCP use dash-separated codes (e.g. "us-east-1", "us-central1").
  return cloud === "azure"
    ? lower.replace(/[_-]/g, "")
    : lower.replace(/_/g, "-");
}

/**
 * Parses cloud + region from a Snowflake access URL when the host embeds an
 * explicit cloud token (legacy account-locator hosts like
 * `xy12345.us-east-1.aws.snowflakecomputing.com`). Returns null for modern
 * org-style hosts (`myorg-myacct.snowflakecomputing.com`) that don't encode it
 * — callers should fall back to `SELECT CURRENT_REGION()`.
 */
export function parseSnowflakeCloudRegionFromUrl(
  accessUrl: string | undefined,
): EventForwarderCloudRegion | null {
  if (!accessUrl?.trim()) return null;

  let host: string;
  try {
    const withProtocol = /^https?:\/\//i.test(accessUrl.trim())
      ? accessUrl.trim()
      : `https://${accessUrl.trim()}`;
    host = new URL(withProtocol).hostname.toLowerCase();
  } catch {
    return null;
  }

  if (!host.endsWith(SNOWFLAKE_HOST_SUFFIX)) return null;

  const labels = host.slice(0, -SNOWFLAKE_HOST_SUFFIX.length).split(".");
  const cloudIndex = labels.findIndex((label) =>
    CLOUD_TOKENS.includes(label as EventForwarderCloud),
  );
  // Need a cloud token preceded by a region label.
  if (cloudIndex <= 0) return null;

  const cloud = labels[cloudIndex] as EventForwarderCloud;
  const region = normalizeRegionForCloud(cloud, labels[cloudIndex - 1]);
  if (!region) return null;

  return { cloud, region };
}

/**
 * Normalizes the value returned by Snowflake's `CURRENT_REGION()` (e.g.
 * `AWS_US_EAST_1`, `GCP_EUROPE_WEST4`, `AZURE_WESTUS2`, optionally prefixed with
 * a region group like `PUBLIC.AWS_US_EAST_1`) to {cloud, region}.
 */
export function normalizeSnowflakeCurrentRegion(
  currentRegion: string | undefined,
): EventForwarderCloudRegion | null {
  if (!currentRegion?.trim()) return null;

  // Strip an optional region-group prefix ("PUBLIC.AWS_US_EAST_1").
  const withoutGroup = currentRegion.trim().split(".").pop() ?? "";
  const underscoreIndex = withoutGroup.indexOf("_");
  if (underscoreIndex <= 0) return null;

  const cloudToken = withoutGroup.slice(0, underscoreIndex).toLowerCase();
  if (!CLOUD_TOKENS.includes(cloudToken as EventForwarderCloud)) return null;

  const cloud = cloudToken as EventForwarderCloud;
  const region = normalizeRegionForCloud(
    cloud,
    withoutGroup.slice(underscoreIndex + 1),
  );
  if (!region) return null;

  return { cloud, region };
}

// BigQuery multi-region locations have no single co-located Confluent region.
const BIGQUERY_MULTI_REGION_LOCATIONS = new Set([
  "us",
  "eu",
  "us-multi-region",
  "eu-multi-region",
]);

/**
 * BigQuery is always GCP; the region is the dataset location (e.g.
 * `us-central1`, `europe-west4`). Multi-region locations (`US`, `EU`) have no
 * single co-located Confluent region, so we return null here to fall back to the
 * license server's default cluster rather than forwarding an unroutable region.
 */
export function normalizeBigQueryLocationToCloudRegion(
  location: string | undefined,
): EventForwarderCloudRegion | null {
  const region = location?.trim().toLowerCase();
  if (!region || BIGQUERY_MULTI_REGION_LOCATIONS.has(region)) return null;
  return { cloud: "gcp", region };
}
