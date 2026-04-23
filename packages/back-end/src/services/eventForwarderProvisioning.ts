import * as bq from "@google-cloud/bigquery";
import {
  isValidBigQueryTableName,
  normalizeBigQueryTableNameForEventForwarder,
  stripLeadingUtf8ByteOrderMark,
} from "shared/util";
import { buildEventForwarderAvroSchema } from "shared/event-forwarder-avro";
import { BigQueryEventForwarderStoredConfig } from "shared/types/event-forwarder";
import { BigQueryConnectionParams } from "shared/types/integrations/bigquery";
import { EventForwarderConfigInterface } from "shared/validators";
import { decryptEventForwarderConfigModel } from "back-end/src/services/eventForwarderConfig";
import { registerEventForwarderSchema } from "back-end/src/services/eventForwarderSchemaRegistry";
import { fetch } from "back-end/src/util/http.util";
import { logger } from "back-end/src/util/logger";
import {
  CONFLUENT_CLOUD_API_KEY,
  CONFLUENT_CLOUD_API_SECRET,
  CONFLUENT_ENVIRONMENT_ID,
  CONFLUENT_EVENT_FORWARDER_CONNECTOR_PREFIX,
  CONFLUENT_EVENT_FORWARDER_TOPIC_PARTITIONS,
  CONFLUENT_EVENT_FORWARDER_TOPIC_REPLICATION_FACTOR,
  CONFLUENT_KAFKA_API_KEY,
  CONFLUENT_KAFKA_API_SECRET,
  CONFLUENT_KAFKA_CLUSTER_ID,
  CONFLUENT_KAFKA_REST_ENDPOINT,
  SCHEMA_REGISTRY_API_KEY,
  SCHEMA_REGISTRY_API_SECRET,
  SCHEMA_REGISTRY_URL,
} from "back-end/src/util/secrets";
import { ReqContext } from "back-end/types/request";

type ProvisionResult = {
  error?: string;
};

type ConnectorConfig = Record<string, string>;

const CONFLUENT_CLOUD_BASE_URL = "https://api.confluent.cloud";
const BIGQUERY_STORAGE_SINK_CLASS = "BigQueryStorageSink";

class ConfluentApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = "ConfluentApiError";
  }
}

function toBasicAuth(key: string, secret: string): string {
  return `Basic ${Buffer.from(`${key}:${secret}`).toString("base64")}`;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function sanitizeKafkaName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function sanitizeBigQueryIdentifier(value: string): string {
  const sanitized = value.replace(/[^a-zA-Z0-9_]+/g, "_");
  return /^[A-Za-z_]/.test(sanitized) ? sanitized : `_${sanitized}`;
}

function getConnectorName(config: EventForwarderConfigInterface): string {
  return sanitizeKafkaName(
    `${CONFLUENT_EVENT_FORWARDER_CONNECTOR_PREFIX}-${config.sinkType}-${config.organization}`,
  ).slice(0, 64);
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

async function confluentRequest<T>({
  url,
  method = "GET",
  authHeader,
  body,
}: {
  url: string;
  method?: string;
  authHeader: string;
  body?: unknown;
}): Promise<T> {
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: authHeader,
      "Content-Type": "application/json",
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

  const text = await response.text();
  const parsed = text ? safeParseJson(text) : null;

  if (!response.ok) {
    const errorMessage =
      getConfluentErrorMessage(parsed) ||
      text ||
      `${response.status} ${response.statusText}`;
    throw new ConfluentApiError(errorMessage, response.status);
  }

  return parsed as T;
}

function safeParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function getConfluentErrorMessage(parsed: unknown): string | null {
  if (!parsed || typeof parsed !== "object") return null;

  const candidate = parsed as Record<string, unknown>;
  const message =
    candidate.message ||
    candidate.error_message ||
    candidate.detail ||
    candidate.title;

  return typeof message === "string" ? message : null;
}

function getCloudConnectorsBaseUrl(): string {
  return `${CONFLUENT_CLOUD_BASE_URL}/connect/v1/environments/${CONFLUENT_ENVIRONMENT_ID}/clusters/${CONFLUENT_KAFKA_CLUSTER_ID}/connectors`;
}

function getKafkaTopicsBaseUrl(): string {
  return `${trimTrailingSlash(CONFLUENT_KAFKA_REST_ENDPOINT)}/kafka/v3/clusters/${CONFLUENT_KAFKA_CLUSTER_ID}/topics`;
}

function getConnectorConfigUrl(connectorName: string): string {
  return `${getCloudConnectorsBaseUrl()}/${encodeURIComponent(connectorName)}/config`;
}

/**
 * Confluent validates the BigQuery Storage Write API using Google's credential parser.
 * Strip BOM and canonicalize JSON so the connector receives parseable credentials (see
 * Confluent docs: "Format service account keyfile credentials").
 */
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
 * BigQuery side: Confluent’s “Google Cloud service account” option — credentials
 * are the JSON key in `keyfile` (see Confluent Cloud BigQuery Storage Sink docs).
 * OAuth-based BigQuery auth is only offered when creating the connector in the
 * Confluent UI; Connect API configs use `keyfile` like this.
 */
function buildBigQueryConnectorConfig({
  connectorName,
  topic,
  tableName,
  config,
  projectId,
}: {
  connectorName: string;
  topic: string;
  tableName: string;
  config: BigQueryEventForwarderStoredConfig;
  projectId: string;
}): ConnectorConfig {
  const rawKey = config.serviceAccountKey || "";
  return {
    name: connectorName,
    "connector.class": BIGQUERY_STORAGE_SINK_CLASS,
    "kafka.auth.mode": "KAFKA_API_KEY",
    "kafka.api.key": CONFLUENT_KAFKA_API_KEY,
    "kafka.api.secret": CONFLUENT_KAFKA_API_SECRET,
    topics: topic,
    "topic2table.map": `${topic}:${tableName}`,
    keyfile: rawKey ? normalizeKeyfileJsonString(rawKey) : "",
    project: projectId,
    datasets: config.dataset,
    "tasks.max": "1",
    "input.data.format": "AVRO",
    "input.key.format": "AVRO",
    "schema.context.name": "default",
    "auto.create.tables": "PARTITION by INGESTION TIME",
    "partitioning.type": "DAY",
    "auto.update.schemas": "ADD NEW FIELDS",
    "sanitize.topics": "true",
    "sanitize.field.names": "true",
    "sanitize.field.names.in.array": "true",
    "use.date.time.formatter": "false",
    "use.integer.for.int8.int16": "false",
    "max.poll.interval.ms": "300000",
    "max.poll.records": "500",
    "errors.tolerance": "all",
    "auto.restart.on.user.error": "true",
    "key.converter.key.schema.id.deserializer":
      "io.confluent.kafka.serializers.schema.id.DualSchemaIdDeserializer",
    "key.converter.key.subject.name.strategy": "TopicNameStrategy",
    "key.converter.replace.null.with.default": "true",
    "key.converter.schemas.enable": "false",
    "value.converter.value.schema.id.deserializer":
      "io.confluent.kafka.serializers.schema.id.DualSchemaIdDeserializer",
    "value.converter.reference.subject.name.strategy":
      "DefaultReferenceSubjectNameStrategy",
    "value.converter.schemas.enable": "false",
    "value.converter.ignore.default.for.nullables": "false",
    "value.converter.decimal.format": "BASE64",
    "value.converter.value.subject.name.strategy": "TopicNameStrategy",
    "value.converter.flatten.singleton.unions": "false",
    "value.converter.replace.null.with.default": "true",
  };
}

function getMissingProvisioningConfig(): string[] {
  const missing: string[] = [];

  if (!CONFLUENT_CLOUD_API_KEY) missing.push("CONFLUENT_CLOUD_API_KEY");
  if (!CONFLUENT_CLOUD_API_SECRET) missing.push("CONFLUENT_CLOUD_API_SECRET");
  if (!CONFLUENT_ENVIRONMENT_ID) missing.push("CONFLUENT_ENVIRONMENT_ID");
  if (!CONFLUENT_KAFKA_CLUSTER_ID) missing.push("CONFLUENT_KAFKA_CLUSTER_ID");
  if (!CONFLUENT_KAFKA_REST_ENDPOINT) {
    missing.push("CONFLUENT_KAFKA_REST_ENDPOINT");
  }
  if (!CONFLUENT_KAFKA_API_KEY) missing.push("CONFLUENT_KAFKA_API_KEY");
  if (!CONFLUENT_KAFKA_API_SECRET) missing.push("CONFLUENT_KAFKA_API_SECRET");
  if (!SCHEMA_REGISTRY_URL) missing.push("SCHEMA_REGISTRY_URL");
  if (!SCHEMA_REGISTRY_API_KEY) missing.push("SCHEMA_REGISTRY_API_KEY");
  if (!SCHEMA_REGISTRY_API_SECRET) missing.push("SCHEMA_REGISTRY_API_SECRET");

  return missing;
}

async function ensureKafkaTopic(topic: string): Promise<void> {
  const authHeader = toBasicAuth(
    CONFLUENT_KAFKA_API_KEY,
    CONFLUENT_KAFKA_API_SECRET,
  );
  const topicUrl = `${getKafkaTopicsBaseUrl()}/${encodeURIComponent(topic)}`;

  try {
    await confluentRequest({
      url: topicUrl,
      authHeader,
    });
    return;
  } catch (error) {
    if (!(error instanceof ConfluentApiError) || error.status !== 404) {
      throw error;
    }
  }

  await confluentRequest({
    url: getKafkaTopicsBaseUrl(),
    method: "POST",
    authHeader,
    body: {
      topic_name: topic,
      partitions_count: CONFLUENT_EVENT_FORWARDER_TOPIC_PARTITIONS,
      replication_factor: CONFLUENT_EVENT_FORWARDER_TOPIC_REPLICATION_FACTOR,
    },
  });
}

async function getConnectorConfig(
  connectorName: string,
): Promise<ConnectorConfig | null> {
  try {
    return await confluentRequest<ConnectorConfig>({
      url: getConnectorConfigUrl(connectorName),
      authHeader: toBasicAuth(
        CONFLUENT_CLOUD_API_KEY,
        CONFLUENT_CLOUD_API_SECRET,
      ),
    });
  } catch (error) {
    if (error instanceof ConfluentApiError && error.status === 404) {
      return null;
    }
    throw error;
  }
}

async function updateConnectorConfig({
  connectorName,
  config,
}: {
  connectorName: string;
  config: ConnectorConfig;
}): Promise<void> {
  await confluentRequest({
    url: getConnectorConfigUrl(connectorName),
    method: "PUT",
    authHeader: toBasicAuth(
      CONFLUENT_CLOUD_API_KEY,
      CONFLUENT_CLOUD_API_SECRET,
    ),
    body: config,
  });
}

async function createConnector({
  connectorName,
  config,
}: {
  connectorName: string;
  config: ConnectorConfig;
}): Promise<void> {
  await confluentRequest({
    url: getCloudConnectorsBaseUrl(),
    method: "POST",
    authHeader: toBasicAuth(
      CONFLUENT_CLOUD_API_KEY,
      CONFLUENT_CLOUD_API_SECRET,
    ),
    body: {
      name: connectorName,
      config,
    },
  });
}

function shouldUpdateConnector(
  existingConfig: ConnectorConfig,
  desiredConfig: ConnectorConfig,
): boolean {
  return Object.entries(desiredConfig).some(
    ([key, value]) => existingConfig[key] !== value,
  );
}

async function getTargetTableName(
  config: BigQueryEventForwarderStoredConfig,
  connectorName: string,
  projectId: string,
): Promise<string> {
  const trimmed = config.tableName.trim();
  if (!trimmed) {
    throw new Error("Missing BigQuery event forwarder table name");
  }

  const baseTableName = normalizeBigQueryTableNameForEventForwarder(trimmed);

  if (!config.dataset || !projectId) {
    throw new Error(
      "Missing BigQuery project or dataset needed for connector provisioning",
    );
  }

  validateBigQueryTableName(baseTableName);

  const rawKey = config.serviceAccountKey?.trim() || "";
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
    .dataset(config.dataset, { projectId })
    .table(baseTableName)
    .exists();

  return tableExists
    ? getFallbackTableName(baseTableName, connectorName)
    : baseTableName;
}

async function ensureBigQueryConnector(
  eventForwarderConfig: EventForwarderConfigInterface,
  projectId: string,
): Promise<string> {
  const connectorName = getConnectorName(eventForwarderConfig);
  const existing = await getConnectorConfig(connectorName);
  const config =
    decryptEventForwarderConfigModel<BigQueryEventForwarderStoredConfig>(
      eventForwarderConfig,
    );
  const tableName = await getTargetTableName(config, connectorName, projectId);
  const desiredConfig = buildBigQueryConnectorConfig({
    connectorName,
    topic: eventForwarderConfig.topic,
    tableName,
    config,
    projectId,
  });

  if (existing && shouldUpdateConnector(existing, desiredConfig)) {
    await updateConnectorConfig({
      connectorName,
      config: desiredConfig,
    });
    return connectorName;
  }

  if (!existing) {
    await createConnector({
      connectorName,
      config: desiredConfig,
    });
  }

  return connectorName;
}

export async function maybeProvisionEventForwarderConfig(
  context: ReqContext,
  eventForwarderConfig: EventForwarderConfigInterface | null,
  bigqueryConnectionParams?: BigQueryConnectionParams,
): Promise<ProvisionResult> {
  if (!eventForwarderConfig) {
    return {};
  }

  if (eventForwarderConfig.sinkType !== "bigquery") {
    return {};
  }

  const projectId =
    bigqueryConnectionParams?.defaultProject?.trim() ||
    bigqueryConnectionParams?.projectId?.trim() ||
    "";

  try {
    const missingConfig = getMissingProvisioningConfig();
    if (missingConfig.length > 0) {
      throw new Error(
        `Missing Confluent provisioning config: ${missingConfig.join(", ")}`,
      );
    }

    if (!projectId) {
      throw new Error(
        "Missing BigQuery connector project id for event forwarder provisioning",
      );
    }

    await ensureKafkaTopic(eventForwarderConfig.topic);

    const avroSchema = buildEventForwarderAvroSchema({
      attributeSchema: context.org.settings?.attributeSchema ?? [],
    });
    const schemaId = await registerEventForwarderSchema(
      eventForwarderConfig.topic,
      avroSchema,
    );
    const connectorName = await ensureBigQueryConnector(
      eventForwarderConfig,
      projectId,
    );
    await context.models.eventForwarderConfigs.update(eventForwarderConfig, {
      schemaId,
      status: "ready",
      connectorName,
      lastProvisioningError: "",
    });

    return {};
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown provisioning error";
    logger.error(
      {
        eventForwarderConfigId: eventForwarderConfig.id,
        organizationId: context.org.id,
        error: message,
      },
      "Failed to provision event forwarder config",
    );

    await context.models.eventForwarderConfigs.update(eventForwarderConfig, {
      status: "error",
      connectorName: getConnectorName(eventForwarderConfig),
      lastProvisioningError: message,
    });

    return {
      error: message,
    };
  }
}
