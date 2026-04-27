import * as bq from "@google-cloud/bigquery";
import {
  isValidBigQueryTableName,
  normalizeBigQueryTableNameForEventForwarder,
  stripLeadingUtf8ByteOrderMark,
} from "shared/util";
import { BigQueryEventForwarderStoredConfig } from "shared/types/event-forwarder";
import { EventForwarderConfigInterface } from "shared/validators";
import { decryptEventForwarderConfigModel } from "back-end/src/services/eventForwarderConfig";

function sanitizeBigQueryIdentifier(value: string): string {
  const sanitized = value.replace(/[^a-zA-Z0-9_]+/g, "_");
  return /^[A-Za-z_]/.test(sanitized) ? sanitized : `_${sanitized}`;
}

function getFallbackTableName(
  baseTableName: string,
  connectorName: string,
): string {
  const suffix = sanitizeBigQueryIdentifier(connectorName).slice(-16);
  return `${baseTableName}_${suffix}`;
}

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

function normalizeKeyfileJsonString(keyfile: string): string {
  const trimmed = stripLeadingUtf8ByteOrderMark(keyfile).trim();
  if (!trimmed) return "";
  try {
    return JSON.stringify(JSON.parse(trimmed));
  } catch {
    throw new Error(
      "Event forwarder service account key is not valid JSON. Re-upload the GCP service account key file from the BigQuery datasource settings.",
    );
  }
}

/**
 * Resolves the BigQuery table name for the Confluent sink (base name or fallback
 * when the table already exists). GrowthBook runs this before calling the license server.
 */
export async function resolveBigQueryEventForwarderTableName(
  eventForwarderConfig: EventForwarderConfigInterface,
  projectId: string,
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

  if (!storedConfig.dataset || !projectId) {
    throw new Error(
      "Missing BigQuery project or dataset needed for connector provisioning",
    );
  }

  validateBigQueryTableName(baseTableName);

  const rawKey = storedConfig.serviceAccountKey?.trim() || "";
  const keyfile = JSON.parse(
    rawKey ? normalizeKeyfileJsonString(rawKey) : "{}",
  ) as {
    client_email?: string;
    private_key?: string;
  };
  const client = new bq.BigQuery({
    projectId,
    credentials: {
      client_email: keyfile.client_email || "",
      private_key: keyfile.private_key || "",
    },
  });
  const [tableExists] = await client
    .dataset(storedConfig.dataset, { projectId })
    .table(baseTableName)
    .exists();

  const connectorName =
    eventForwarderConfig.connectorName?.trim() ||
    eventForwarderConfig.connectorId?.trim() ||
    eventForwarderConfig.datasourceId;

  return tableExists
    ? getFallbackTableName(baseTableName, connectorName)
    : baseTableName;
}
