import {
  resolveDetectedEventForwarderRegion,
  warehouseRegionIdFromBigQueryLocation,
  warehouseRegionIdFromDatabricksZerobusEndpoint,
  warehouseRegionIdFromSnowflakeCurrentRegion,
} from "shared/util";
import { BigQueryConnectionParams } from "shared/types/integrations/bigquery";
import { SnowflakeConnectionParams } from "shared/types/integrations/snowflake";
import { createBigQueryClient } from "back-end/src/services/bigqueryClient";
import { runSnowflakeQuery } from "back-end/src/services/snowflake";
import { getErrorMessage } from "back-end/src/util/errors";
import { logger } from "back-end/src/util/logger";

type DetectRegionInput = {
  type: "bigquery" | "snowflake" | "databricks";
  params: Record<string, unknown>;
  location: string;
  zerobusEndpoint?: string;
};

export type DetectedEventForwarderRegion = NonNullable<
  ReturnType<typeof resolveDetectedEventForwarderRegion>
>;

async function detectWarehouseRegionId(
  input: DetectRegionInput,
): Promise<string | null> {
  if (input.type === "databricks") {
    return warehouseRegionIdFromDatabricksZerobusEndpoint(
      input.zerobusEndpoint ?? "",
    );
  }

  if (input.type === "bigquery") {
    const params = input.params as Partial<BigQueryConnectionParams>;
    const projectId = params.defaultProject || params.projectId || "";
    const datasetId = input.location.trim();
    if (!projectId || !datasetId) return null;
    const client = createBigQueryClient(params as BigQueryConnectionParams);
    const [metadata] = await client
      .dataset(datasetId, { projectId })
      .getMetadata();
    const location =
      metadata && typeof metadata.location === "string"
        ? metadata.location
        : "";
    return warehouseRegionIdFromBigQueryLocation(location);
  }

  const result = await runSnowflakeQuery<{ region?: unknown }>(
    input.params as unknown as SnowflakeConnectionParams,
    "SELECT CURRENT_REGION() AS region",
    undefined,
    { queryType: "informationSchema" },
  );
  const raw = result.rows[0]?.region;
  if (typeof raw !== "string") return null;
  return warehouseRegionIdFromSnowflakeCurrentRegion(raw);
}

export async function detectEventForwarderWarehouseRegion(
  input: DetectRegionInput,
): Promise<DetectedEventForwarderRegion | null> {
  try {
    const warehouseRegionId = await detectWarehouseRegionId(input);
    return resolveDetectedEventForwarderRegion(input.type, warehouseRegionId);
  } catch (error) {
    logger.info(
      { type: input.type, message: getErrorMessage(error) },
      "Could not detect event forwarder warehouse region",
    );
    return null;
  }
}
