import { DataSourceInterface } from "shared/types/datasource";
import {
  BigQueryEventForwarderStoredConfig,
  EventForwarderSinkType,
  SnowflakeEventForwarderStoredConfig,
} from "shared/types/event-forwarder";
import { BigQueryConnectionParams } from "shared/types/integrations/bigquery";
import {
  EventForwarderCloudRegion,
  EventForwarderDatasourceParams,
  normalizeBigQueryLocationToCloudRegion,
  normalizeSnowflakeCurrentRegion,
  parseSnowflakeCloudRegionFromUrl,
} from "shared/util";
import { getSourceIntegrationObject } from "back-end/src/services/datasource";
import { getBigQueryEventForwarderDatasetLocation } from "back-end/src/services/eventForwarder/bigquery";
import { getBigQueryEventForwarderProjectId } from "back-end/src/services/eventForwarder/config";
import SqlIntegration from "back-end/src/integrations/SqlIntegration";
import { logger } from "back-end/src/util/logger";
import { ReqContext } from "back-end/types/request";

/**
 * Derives the destination warehouse's cloud + region so the Event Forwarder can
 * route to a co-located Confluent cluster. Best-effort: returns null on any
 * failure so provisioning falls back to the license server's default cluster.
 *
 * - Snowflake: parse the access URL (legacy locator hosts); else `CURRENT_REGION()`.
 * - BigQuery: cloud is always GCP; region is the dataset location.
 */
export async function deriveEventForwarderCloudRegion({
  context,
  datasource,
  sinkType,
  decryptedConfig,
  datasourceParams,
}: {
  context: ReqContext;
  datasource: DataSourceInterface;
  sinkType: EventForwarderSinkType;
  decryptedConfig:
    | BigQueryEventForwarderStoredConfig
    | SnowflakeEventForwarderStoredConfig;
  datasourceParams?: EventForwarderDatasourceParams;
}): Promise<EventForwarderCloudRegion | null> {
  try {
    switch (sinkType) {
      case "snowflake": {
        const config = decryptedConfig as SnowflakeEventForwarderStoredConfig;
        const fromUrl = parseSnowflakeCloudRegionFromUrl(config.accessUrl);
        if (fromUrl) return fromUrl;
        return await deriveSnowflakeCloudRegionViaQuery(context, datasource);
      }
      case "bigquery": {
        const config = decryptedConfig as BigQueryEventForwarderStoredConfig;
        const projectId = getBigQueryEventForwarderProjectId(
          config,
          datasourceParams as BigQueryConnectionParams | undefined,
        );
        if (!projectId || !config.dataset?.trim()) return null;
        const location = await getBigQueryEventForwarderDatasetLocation({
          projectId,
          dataset: config.dataset.trim(),
          serviceAccountKey: config.serviceAccountKey,
        });
        return normalizeBigQueryLocationToCloudRegion(location ?? undefined);
      }
      default:
        return null;
    }
  } catch (error) {
    logger.warn(
      error,
      "Failed to derive event forwarder cloud/region; falling back to default cluster",
    );
    return null;
  }
}

async function deriveSnowflakeCloudRegionViaQuery(
  context: ReqContext,
  datasource: DataSourceInterface,
): Promise<EventForwarderCloudRegion | null> {
  const integration = getSourceIntegrationObject(context, datasource, true);
  if (!(integration instanceof SqlIntegration)) return null;

  const result = await integration.runTestQuery(
    "SELECT CURRENT_REGION() AS region",
  );
  const row = result.results?.[0] as
    | { region?: unknown; REGION?: unknown }
    | undefined;
  const raw = row?.region ?? row?.REGION;
  return normalizeSnowflakeCurrentRegion(
    typeof raw === "string" ? raw : undefined,
  );
}
