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

/** Deterministic connector name; persisted on the document after first successful provision. */
export function getEventForwarderConnectorName(
  config: EventForwarderConfigInterface,
): string {
  const dsPart = sanitizeKafkaName(config.datasourceId);
  return sanitizeKafkaName(
    `${CONFLUENT_EVENT_FORWARDER_CONNECTOR_PREFIX}-${config.sinkType}-${config.organization}-${dsPart}`,
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

/** Secrets required for Confluent Connect API (connector lifecycle, connector resource id). */
function getMissingCloudConnectProvisioningConfig(): string[] {
  const missing: string[] = [];
  if (!CONFLUENT_CLOUD_API_KEY) missing.push("CONFLUENT_CLOUD_API_KEY");
  if (!CONFLUENT_CLOUD_API_SECRET) missing.push("CONFLUENT_CLOUD_API_SECRET");
  if (!CONFLUENT_ENVIRONMENT_ID) missing.push("CONFLUENT_ENVIRONMENT_ID");
  if (!CONFLUENT_KAFKA_CLUSTER_ID) missing.push("CONFLUENT_KAFKA_CLUSTER_ID");
  return missing;
}

/** Secrets required for Kafka REST (topic create/delete). Schema Registry is not used here. */
function getMissingKafkaRestProvisioningConfig(): string[] {
  const missing: string[] = [];
  if (!CONFLUENT_KAFKA_CLUSTER_ID) missing.push("CONFLUENT_KAFKA_CLUSTER_ID");
  if (!CONFLUENT_KAFKA_REST_ENDPOINT) {
    missing.push("CONFLUENT_KAFKA_REST_ENDPOINT");
  }
  if (!CONFLUENT_KAFKA_API_KEY) missing.push("CONFLUENT_KAFKA_API_KEY");
  if (!CONFLUENT_KAFKA_API_SECRET) missing.push("CONFLUENT_KAFKA_API_SECRET");
  return missing;
}

function parseConnectorResourceId(parsed: unknown): string | null {
  if (!parsed || typeof parsed !== "object") return null;
  const root = parsed as Record<string, unknown>;
  const idField = root.id;
  if (typeof idField === "string" && idField.startsWith("lcc-")) {
    return idField;
  }
  if (idField && typeof idField === "object") {
    const inner = (idField as Record<string, unknown>).id;
    if (typeof inner === "string" && inner.startsWith("lcc-")) {
      return inner;
    }
  }
  return null;
}

/** Confluent DLQ topic for a managed connector: `dlq-` + resource id. `resourceId` is `connectorId` on the event forwarder doc (`lcc-*`). */
function dlqTopicNameForConnectorResourceId(resourceId: string): string | null {
  const id = resourceId.trim();
  return id.startsWith("lcc-") ? `dlq-${id}` : null;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Confluent Cloud DLQ topics are named `dlq-{resourceId}` where resourceId is the managed
 * connector id (e.g. lcc-abc123).
 *
 * Confluent documents `lcc-*` ids on **list** connectors with `expand=id`; per-connector GET
 * may omit `id`, so we try the expanded list first, then GET `.../connectors/{name}?expand=id`.
 */
async function getManagedConnectorResourceId(
  connectorName: string,
): Promise<string | null> {
  const authHeader = toBasicAuth(
    CONFLUENT_CLOUD_API_KEY,
    CONFLUENT_CLOUD_API_SECRET,
  );

  try {
    const expanded = await confluentRequest<unknown>({
      url: `${getCloudConnectorsBaseUrl()}?expand=id`,
      authHeader,
    });
    if (expanded && typeof expanded === "object" && !Array.isArray(expanded)) {
      const entry = (expanded as Record<string, unknown>)[connectorName];
      const id = entry ? parseConnectorResourceId(entry) : null;
      if (id) return id;
    }
  } catch {
    // Fall through — list can fail or omit the new connector briefly after create.
  }

  const singleUrl = `${getCloudConnectorsBaseUrl()}/${encodeURIComponent(
    connectorName,
  )}?expand=id`;
  try {
    const parsed = await confluentRequest<unknown>({
      url: singleUrl,
      authHeader,
    });
    return parseConnectorResourceId(parsed);
  } catch (error) {
    if (error instanceof ConfluentApiError && error.status === 404) {
      return null;
    }
    throw error;
  }
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
  const stored = eventForwarderConfig.connectorName?.trim();
  const connectorName =
    stored && stored.length > 0
      ? stored
      : getEventForwarderConnectorName(eventForwarderConfig);
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

async function deleteConnectorIfExists(
  connectorName: string,
  logFields?: { eventForwarderConfigId?: string },
): Promise<void> {
  const url = `${getCloudConnectorsBaseUrl()}/${encodeURIComponent(
    connectorName,
  )}`;
  logger.info(
    {
      ...logFields,
      connectorName,
      deleteUrl: url,
    },
    "Teardown: deleting Confluent BigQuery Storage Sink connector",
  );
  try {
    await confluentRequest({
      url,
      method: "DELETE",
      authHeader: toBasicAuth(
        CONFLUENT_CLOUD_API_KEY,
        CONFLUENT_CLOUD_API_SECRET,
      ),
    });
    logger.info(
      {
        ...logFields,
        connectorName,
        deleteUrl: url,
      },
      "Teardown: Confluent connector delete completed (connector removed or API returned success)",
    );
  } catch (error) {
    if (error instanceof ConfluentApiError && error.status === 404) {
      logger.info(
        {
          ...logFields,
          connectorName,
          deleteUrl: url,
        },
        "Teardown: Confluent connector was already absent (404)",
      );
      return;
    }
    throw error;
  }
}

async function deleteKafkaTopicIfExists(
  topic: string,
  logFields?: {
    eventForwarderConfigId?: string;
    topicRole?: "main" | "dlq";
  },
): Promise<void> {
  const authHeader = toBasicAuth(
    CONFLUENT_KAFKA_API_KEY,
    CONFLUENT_KAFKA_API_SECRET,
  );
  const topicUrl = `${getKafkaTopicsBaseUrl()}/${encodeURIComponent(topic)}`;
  logger.info(
    {
      ...logFields,
      topic,
      topicRole: logFields?.topicRole,
      deleteUrl: topicUrl,
    },
    "Teardown: deleting Kafka topic",
  );
  try {
    await confluentRequest({
      url: topicUrl,
      method: "DELETE",
      authHeader,
    });
    logger.info(
      {
        ...logFields,
        topic,
        topicRole: logFields?.topicRole,
        deleteUrl: topicUrl,
      },
      "Teardown: Kafka topic delete completed (topic removed or API returned success)",
    );
  } catch (error) {
    if (error instanceof ConfluentApiError && error.status === 404) {
      logger.info(
        {
          ...logFields,
          topic,
          topicRole: logFields?.topicRole,
          deleteUrl: topicUrl,
        },
        "Teardown: Kafka topic was already absent (404)",
      );
      return;
    }
    throw error;
  }
}

/**
 * Deletes the Confluent BigQuery Storage Sink connector and Kafka topics using names stored on the
 * config document (not recomputed from env), so changing CONFLUENT_* prefix defaults does not
 * target the wrong resources. API base URLs still use current deployment secrets.
 *
 * The DLQ topic `dlq-lcc-*` is deleted using persisted `connectorId` (`lcc-*`) when present; if it
 * was never stored, resolves the id via the Connect API once before deleting the connector.
 */
export async function teardownBigQueryEventForwarderInfrastructure(
  config: EventForwarderConfigInterface,
): Promise<void> {
  logger.info(
    { eventForwarderConfigId: config.id },
    "BigQuery event forwarder teardown: function invoked",
  );
  const missingCloud = getMissingCloudConnectProvisioningConfig();
  const missingKafka = getMissingKafkaRestProvisioningConfig();

  const connectorName = config.connectorName?.trim() ?? "";
  const topic = config.topic?.trim() ?? "";

  /** Set on successful provisioning; names the DLQ topic `dlq-<connectorId>`. */
  let storedResourceId = config.connectorId?.trim() ?? "";
  if (!storedResourceId.startsWith("lcc-")) {
    storedResourceId = "";
  }

  let connectorResourceIdForDlq = storedResourceId;

  if (
    !connectorResourceIdForDlq &&
    connectorName &&
    missingCloud.length === 0
  ) {
    try {
      connectorResourceIdForDlq =
        (await getManagedConnectorResourceId(connectorName)) ?? "";
    } catch (error) {
      logger.warn(
        {
          err: error,
          connectorName,
          eventForwarderConfigId: config.id,
        },
        "Could not resolve Confluent connector resource id for DLQ topic teardown",
      );
    }
  } else if (
    !connectorResourceIdForDlq &&
    connectorName &&
    missingCloud.length > 0
  ) {
    logger.warn(
      {
        eventForwarderConfigId: config.id,
        connectorName,
        missingCloudConnectSecrets: missingCloud,
      },
      "Skipping connector resource id fetch for DLQ teardown: incomplete Confluent Cloud Connect secrets",
    );
  }

  const dlqTopic =
    dlqTopicNameForConnectorResourceId(connectorResourceIdForDlq) ?? "";

  logger.info(
    {
      eventForwarderConfigId: config.id,
      connectorName: connectorName || undefined,
      kafkaTopic: topic || undefined,
      dlqTopic: dlqTopic || undefined,
      storedConnectorId: storedResourceId || undefined,
      resolvedConnectorResourceId: connectorResourceIdForDlq || undefined,
      missingCloudConnectSecrets:
        missingCloud.length > 0 ? missingCloud : undefined,
      missingKafkaRestSecrets:
        missingKafka.length > 0 ? missingKafka : undefined,
    },
    "BigQuery event forwarder teardown: resolved Confluent resource names for delete attempts",
  );

  if (missingCloud.length > 0) {
    logger.warn(
      {
        eventForwarderConfigId: config.id,
        missingCloudConnectSecrets: missingCloud,
        connectorName: connectorName || undefined,
        manualConnectorDeleteUrl: connectorName
          ? `${getCloudConnectorsBaseUrl()}/${encodeURIComponent(connectorName)}`
          : undefined,
      },
      "Skipping Confluent connector delete: incomplete Cloud Connect secrets (remove connector manually if needed)",
    );
  } else if (!connectorName) {
    logger.warn(
      { eventForwarderConfigId: config.id },
      "Skipping connector delete: no connectorName stored on event forwarder config (never provisioned successfully)",
    );
  } else {
    try {
      await deleteConnectorIfExists(connectorName, {
        eventForwarderConfigId: config.id,
      });
    } catch (error) {
      logger.error(
        {
          err: error,
          connectorName,
          eventForwarderConfigId: config.id,
        },
        "Failed to delete BigQuery Storage Sink connector for event forwarder",
      );
    }
  }

  if (missingKafka.length > 0) {
    logger.warn(
      {
        eventForwarderConfigId: config.id,
        missingKafkaRestSecrets: missingKafka,
        kafkaTopic: topic || undefined,
        dlqTopic: dlqTopic || undefined,
        connectorName: connectorName || undefined,
        manualKafkaTopicDeleteBaseUrl: getKafkaTopicsBaseUrl(),
      },
      "Skipping Kafka topic deletes: incomplete Kafka REST secrets — delete main/DLQ topics manually in Confluent if needed",
    );
    return;
  }

  if (!topic) {
    logger.warn(
      { eventForwarderConfigId: config.id },
      "Skipping Kafka topic delete: no topic stored on event forwarder config",
    );
  } else {
    try {
      await deleteKafkaTopicIfExists(topic, {
        eventForwarderConfigId: config.id,
        topicRole: "main",
      });
    } catch (error) {
      logger.error(
        {
          err: error,
          topic,
          eventForwarderConfigId: config.id,
        },
        "Failed to delete Kafka topic for event forwarder",
      );
    }
  }

  if (dlqTopic) {
    try {
      await deleteKafkaTopicIfExists(dlqTopic, {
        eventForwarderConfigId: config.id,
        topicRole: "dlq",
      });
    } catch (error) {
      logger.error(
        {
          err: error,
          topic: dlqTopic,
          eventForwarderConfigId: config.id,
        },
        "Failed to delete connector DLQ Kafka topic for event forwarder",
      );
    }
  } else if (connectorName || storedResourceId) {
    logger.warn(
      {
        eventForwarderConfigId: config.id,
        connectorName: connectorName || undefined,
        hadStoredConnectorId: Boolean(storedResourceId),
      },
      "Skipping DLQ topic delete: could not determine dlq-lcc* topic name (missing connector resource id)",
    );
  }

  logger.info(
    {
      eventForwarderConfigId: config.id,
      connectorDeleteWasEligible:
        missingCloud.length === 0 && Boolean(connectorName),
      mainKafkaTopicDeleteAttempted: Boolean(topic),
      dlqKafkaTopicDeleteAttempted: Boolean(dlqTopic),
    },
    "BigQuery event forwarder teardown: finished Kafka topic phase (see earlier per-resource logs for HTTP outcomes)",
  );
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

    let connectorResourceId = "";
    for (let attempt = 0; attempt < 6; attempt++) {
      connectorResourceId =
        (await getManagedConnectorResourceId(connectorName)) ?? "";
      if (connectorResourceId) break;
      if (attempt < 5) {
        await delay(1500);
      }
    }

    const persistedConnectorId =
      connectorResourceId ||
      (eventForwarderConfig.connectorId?.trim().startsWith("lcc-")
        ? eventForwarderConfig.connectorId!.trim()
        : "");

    if (!persistedConnectorId) {
      logger.warn(
        {
          connectorName,
          eventForwarderConfigId: eventForwarderConfig.id,
          organizationId: context.org.id,
        },
        "Could not resolve Confluent connector resource id after provisioning; connectorId will be empty until a later provision run",
      );
    }

    await context.models.eventForwarderConfigs.update(eventForwarderConfig, {
      schemaId,
      status: "ready",
      connectorName,
      connectorId: persistedConnectorId,
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
      lastProvisioningError: message,
    });

    return {
      error: message,
    };
  }
}
