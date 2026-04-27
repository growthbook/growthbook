import {
  isValidBigQueryTableName,
  normalizeBigQueryTableNameForEventForwarder,
} from "shared/util";
import { BigQueryEventForwarderStoredConfig } from "shared/types/event-forwarder";
import { EventForwarderConfigInterface } from "shared/validators";
import { decryptEventForwarderConfigModel } from "back-end/src/services/eventForwarderConfig";

function validateBigQueryTableName(tableName: string): void {
  if (!tableName) {
    throw new Error("Missing BigQuery event forwarder table name");
  }

  if (!isValidBigQueryTableName(tableName)) {
    throw new Error(
      "Event forwarder table name must be a valid BigQuery table name (letters, numbers, underscores; Unicode letters allowed).",
    );
  }
}

/**
 * Resolves the BigQuery table name for the Confluent sink. Existing tables are reused.
 */
export async function resolveBigQueryEventForwarderTableName(
  eventForwarderConfig: EventForwarderConfigInterface,
): Promise<string> {
  const storedConfig =
    decryptEventForwarderConfigModel<BigQueryEventForwarderStoredConfig>(
      eventForwarderConfig,
    );

  const trimmed = storedConfig.tableName.trim();
  if (!trimmed) {
    throw new Error("Missing BigQuery event forwarder table name");
  }

  const baseTableName = normalizeBigQueryTableNameForEventForwarder(trimmed);

  if (!storedConfig.dataset) {
    throw new Error(
      "Missing BigQuery dataset needed for connector provisioning",
    );
  }

  validateBigQueryTableName(baseTableName);
  return baseTableName;
}
