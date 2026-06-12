import { AES, enc } from "crypto-js";
import isEqual from "lodash/isEqual";
import { DataSourceInterface } from "shared/types/datasource";
import { BigQueryConnectionParams } from "shared/types/integrations/bigquery";
import { SnowflakeConnectionParams } from "shared/types/integrations/snowflake";
import {
  BigQueryEventForwarderConfigDraft,
  BigQueryEventForwarderStoredConfig,
  EventForwarderConfigDraft,
  EventForwarderConfigWithMetadata,
  SnowflakeEventForwarderConfigDraft,
  SnowflakeEventForwarderStoredConfig,
} from "shared/types/event-forwarder";
import { EventForwarderConfigInterface } from "shared/validators";
import {
  DEFAULT_EVENT_FORWARDER_TABLE_PREFIX,
  EventForwarderDatasourceParams,
  getEventForwarderSinkTypeForDatasource,
  normalizeBigQueryTablePrefixForEventForwarder,
  normalizeSnowflakeEventForwarderAccessUrl,
  normalizeSnowflakeTablePrefixForEventForwarder,
} from "shared/util";
import { ReqContext } from "back-end/types/request";
import { ENCRYPTION_KEY } from "back-end/src/util/secrets";

type SinkConfig =
  | BigQueryEventForwarderStoredConfig
  | SnowflakeEventForwarderStoredConfig;

function sanitizeKafkaName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Kafka topic pinned at create; includes datasource so topics are unique per forwarder. */
export function getEventForwarderTopicName(
  orgId: string,
  datasourceId: string,
): string {
  return sanitizeKafkaName(`gb-events-${orgId}-${datasourceId}`);
}

function encryptSinkConfig(config: SinkConfig): string {
  return AES.encrypt(JSON.stringify(config), ENCRYPTION_KEY).toString();
}

function decryptSinkConfig<T extends SinkConfig>(encrypted: string): T {
  return JSON.parse(AES.decrypt(encrypted, ENCRYPTION_KEY).toString(enc.Utf8));
}

export function getBigQueryEventForwarderTablePrefix(
  config: BigQueryEventForwarderStoredConfig,
): string {
  return normalizeBigQueryTablePrefixForEventForwarder(config.tablePrefix);
}

export function getBigQueryEventForwarderProjectId(
  config: BigQueryEventForwarderStoredConfig,
  datasourceParams?: BigQueryConnectionParams,
): string {
  return (
    config.projectId?.trim() ||
    datasourceParams?.defaultProject?.trim() ||
    datasourceParams?.projectId?.trim() ||
    ""
  );
}

export function getSnowflakeEventForwarderTablePrefix(
  config: SnowflakeEventForwarderStoredConfig,
): string {
  return normalizeSnowflakeTablePrefixForEventForwarder(config.tablePrefix);
}

export async function getEventForwarderForDatasource(
  context: ReqContext,
  datasourceId: string,
): Promise<EventForwarderConfigInterface | null> {
  return context.models.eventForwarderConfigs.getByDatasourceId(datasourceId);
}

export async function hasAnyEventForwarderConfig(
  context: ReqContext,
): Promise<boolean> {
  const configs = await context.models.eventForwarderConfigs.getAll();
  return configs.length > 0;
}

// GCP service account key JSON for Confluent BigQuery Storage Sink (not OAuth connector mode).
function buildBigQueryServiceAccountKey(
  params: BigQueryConnectionParams,
): string | null {
  if (!params.projectId || !params.clientEmail || !params.privateKey) {
    return null;
  }

  const clientEmail = params.clientEmail;
  return JSON.stringify({
    type: "service_account",
    project_id: params.projectId,
    private_key_id: "",
    private_key: params.privateKey,
    client_email: clientEmail,
    client_id: "",
    auth_uri: "https://accounts.google.com/o/oauth2/auth",
    token_uri: "https://oauth2.googleapis.com/token",
    auth_provider_x509_cert_url: "https://www.googleapis.com/oauth2/v1/certs",
    client_x509_cert_url: `https://www.googleapis.com/robot/v1/metadata/x509/${encodeURIComponent(
      clientEmail,
    )}`,
  });
}

function buildBigQueryStoredConfigFromDraft(
  draft: BigQueryEventForwarderConfigDraft,
  datasourceParams: BigQueryConnectionParams | undefined,
  existingModel: EventForwarderConfigInterface | null,
): BigQueryEventForwarderStoredConfig {
  const existingStored =
    existingModel?.sinkType === "bigquery"
      ? decryptSinkConfig<BigQueryEventForwarderStoredConfig>(
          existingModel.config,
        )
      : null;

  const projectId =
    draft.projectId?.trim() ||
    existingStored?.projectId?.trim() ||
    datasourceParams?.defaultProject?.trim() ||
    datasourceParams?.projectId?.trim() ||
    "";
  const dataset =
    draft.dataset?.trim() ||
    existingStored?.dataset?.trim() ||
    datasourceParams?.defaultDataset?.trim() ||
    "";
  const tablePrefix = normalizeBigQueryTablePrefixForEventForwarder(
    draft.tablePrefix ?? DEFAULT_EVENT_FORWARDER_TABLE_PREFIX,
  );

  const serviceAccountKey =
    draft.serviceAccountKey?.trim() ||
    existingStored?.serviceAccountKey ||
    datasourceParams?.serviceAccountJson?.trim() ||
    buildBigQueryServiceAccountKey(
      datasourceParams || ({} as BigQueryConnectionParams),
    ) ||
    "";

  return {
    projectId,
    dataset,
    tablePrefix,
    serviceAccountKey,
  };
}

// Confluent's `snowflake.private.key` expects a single base64 blob without
// PEM armor or whitespace. Strip both the unencrypted and encrypted PKCS#8
// headers/footers and collapse all whitespace.
export function normalizeSnowflakePrivateKeyForEventForwarder(
  raw: string | undefined,
): string {
  if (!raw) return "";
  return raw
    .replace(/-----BEGIN (?:ENCRYPTED )?PRIVATE KEY-----/g, "")
    .replace(/-----END (?:ENCRYPTED )?PRIVATE KEY-----/g, "")
    .replace(/\s+/g, "");
}

function buildSnowflakeStoredConfigFromDraft(
  draft: SnowflakeEventForwarderConfigDraft,
  datasourceParams: SnowflakeConnectionParams | undefined,
  existingModel: EventForwarderConfigInterface | null,
): SnowflakeEventForwarderStoredConfig {
  const existingStored =
    existingModel?.sinkType === "snowflake"
      ? decryptSinkConfig<SnowflakeEventForwarderStoredConfig>(
          existingModel.config,
        )
      : null;

  const database =
    draft.database?.trim().toUpperCase() ||
    existingStored?.database?.trim() ||
    datasourceParams?.database?.trim() ||
    "";
  const schema =
    draft.schema?.trim().toUpperCase() ||
    existingStored?.schema?.trim() ||
    datasourceParams?.schema?.trim() ||
    "";
  const tablePrefix = normalizeSnowflakeTablePrefixForEventForwarder(
    draft.tablePrefix ?? DEFAULT_EVENT_FORWARDER_TABLE_PREFIX,
  );

  let accessUrl: string | undefined;
  if (draft.accessUrl?.trim()) {
    accessUrl = normalizeSnowflakeEventForwarderAccessUrl(draft.accessUrl);
  } else if (existingStored?.accessUrl?.trim()) {
    accessUrl = existingStored.accessUrl.trim();
  }

  const authMethod = datasourceParams?.authMethod ?? "password";
  if (authMethod !== "key-pair") {
    throw new Error(
      "Snowflake event forwarder requires key-pair authentication. Password authentication is supported for Snowflake queries, but Confluent Snowflake Sink provisioning requires a private key.",
    );
  }

  return {
    tablePrefix,
    account:
      datasourceParams?.account?.trim() ||
      existingStored?.account?.trim() ||
      "",
    accessUrl,
    username:
      datasourceParams?.username?.trim() ||
      existingStored?.username?.trim() ||
      "",
    database,
    schema,
    privateKey:
      normalizeSnowflakePrivateKeyForEventForwarder(
        datasourceParams?.privateKey,
      ) ||
      normalizeSnowflakePrivateKeyForEventForwarder(
        existingStored?.privateKey,
      ) ||
      "",
    privateKeyPassword:
      datasourceParams?.privateKeyPassword?.trim() ||
      existingStored?.privateKeyPassword?.trim() ||
      undefined,
    role:
      draft.role?.trim() ||
      existingStored?.role?.trim() ||
      datasourceParams?.role?.trim() ||
      undefined,
    warehouse:
      draft.warehouse?.trim() ||
      existingStored?.warehouse?.trim() ||
      datasourceParams?.warehouse?.trim() ||
      undefined,
  };
}

function buildNormalizedSinkPayload(
  draft: EventForwarderConfigDraft,
  datasourceParams: EventForwarderDatasourceParams,
  existingModel: EventForwarderConfigInterface | null,
): SinkConfig {
  switch (draft.sinkType) {
    case "bigquery":
      return buildBigQueryStoredConfigFromDraft(
        draft.config,
        datasourceParams as BigQueryConnectionParams | undefined,
        existingModel,
      );
    case "snowflake":
      return buildSnowflakeStoredConfigFromDraft(
        draft.config,
        datasourceParams as SnowflakeConnectionParams | undefined,
        existingModel,
      );
    default:
      throw new Error(
        `Unsupported event forwarder sink type: ${String((draft as EventForwarderConfigDraft).sinkType)}`,
      );
  }
}

function validateNormalizedSinkPayload(
  draft: EventForwarderConfigDraft,
  datasourceParams: EventForwarderDatasourceParams,
  normalizedPayload: SinkConfig,
): void {
  if (draft.sinkType === "bigquery") {
    const bigQueryParams = datasourceParams as
      | BigQueryConnectionParams
      | undefined;
    const bq = normalizedPayload as BigQueryEventForwarderStoredConfig;
    if (
      !getBigQueryEventForwarderProjectId(bq, bigQueryParams) ||
      !bq.dataset?.trim() ||
      !getBigQueryEventForwarderTablePrefix(bq) ||
      !bq.serviceAccountKey
    ) {
      throw new Error(
        "BigQuery event forwarder requires project, dataset, table prefix, and service account credentials",
      );
    }
  }

  if (draft.sinkType === "snowflake") {
    const snowflake = normalizedPayload as SnowflakeEventForwarderStoredConfig;
    if (
      !snowflake.account ||
      !snowflake.username ||
      !snowflake.database ||
      !snowflake.schema ||
      !getSnowflakeEventForwarderTablePrefix(snowflake) ||
      !snowflake.accessUrl ||
      !snowflake.privateKey ||
      !snowflake.role?.trim()
    ) {
      throw new Error(
        "Snowflake event forwarder requires account, username, destination table prefix (DATABASE.SCHEMA.PREFIX), Snowflake URL, private key credentials, and Snowflake role (required for Snowpipe Streaming schematization)",
      );
    }
  }
}

export function buildNormalizedEventForwarderSinkPayloadForTest(
  draft: EventForwarderConfigDraft,
  datasourceParams: EventForwarderDatasourceParams,
  existingModel: EventForwarderConfigInterface | null,
): SinkConfig {
  const normalizedPayload = buildNormalizedSinkPayload(
    draft,
    datasourceParams,
    existingModel,
  );

  validateNormalizedSinkPayload(draft, datasourceParams, normalizedPayload);

  return normalizedPayload;
}

export function toEventForwarderConfigDraft(
  config: EventForwarderConfigInterface | null,
): EventForwarderConfigDraft | null {
  if (!config) return null;

  switch (config.sinkType) {
    case "bigquery": {
      const decrypted = decryptSinkConfig<
        BigQueryEventForwarderStoredConfig & { projectId?: string }
      >(config.config);
      return {
        sinkType: "bigquery",
        config: {
          projectId: decrypted.projectId || "",
          dataset: decrypted.dataset || "",
          tablePrefix: getBigQueryEventForwarderTablePrefix(decrypted),
          serviceAccountKey: "",
        },
      };
    }
    case "snowflake": {
      const decrypted = decryptSinkConfig<SnowflakeEventForwarderStoredConfig>(
        config.config,
      );
      return {
        sinkType: "snowflake",
        config: {
          database: decrypted.database || "",
          schema: decrypted.schema || "",
          tablePrefix: getSnowflakeEventForwarderTablePrefix(decrypted),
          accessUrl: decrypted.accessUrl || "",
          role: decrypted.role || "",
          warehouse: decrypted.warehouse || "",
        },
      };
    }
    default:
      throw new Error(
        `Unsupported event forwarder sink type: ${String(config.sinkType)}`,
      );
  }
}

export function stripEventForwarderConfigMetadata(
  draft:
    | EventForwarderConfigDraft
    | EventForwarderConfigWithMetadata
    | null
    | undefined,
): EventForwarderConfigDraft | null | undefined {
  if (draft === undefined || draft === null) {
    return draft;
  }
  if (draft.sinkType === "bigquery") {
    return {
      sinkType: "bigquery",
      config: draft.config,
    };
  }
  return {
    sinkType: draft.sinkType,
    config: draft.config,
  };
}

/**
 * Returns true when the incoming draft matches the stored config (ignoring
 * read-only metadata such as status and connector ids). Used to skip accidental
 * re-provision on generic datasource PUT requests that echo EF config.
 */
export function isEventForwarderDraftUnchanged(
  incoming:
    | EventForwarderConfigDraft
    | EventForwarderConfigWithMetadata
    | null
    | undefined,
  existing: EventForwarderConfigInterface | null,
): boolean {
  if (incoming === undefined || incoming === null || !existing) {
    return false;
  }
  const existingDraft = toEventForwarderConfigDraft(existing);
  if (!existingDraft) {
    return false;
  }
  return isEqual(
    stripEventForwarderConfigMetadata(incoming),
    stripEventForwarderConfigMetadata(existingDraft),
  );
}

export function toEventForwarderConfigWithMetadata(
  config: EventForwarderConfigInterface | null | undefined,
): EventForwarderConfigWithMetadata | null {
  const draft = toEventForwarderConfigDraft(config ?? null);
  if (!config || !draft) return null;

  return {
    ...draft,
    status: config.status,
    connectorName: config.connectorName,
    connectorId: config.connectorId,
    lastProvisioningError: config.lastProvisioningError,
  };
}

export async function getEventForwarderConfigDraftForDatasource(
  context: ReqContext,
  datasource: Pick<DataSourceInterface, "type" | "id">,
): Promise<EventForwarderConfigDraft | null> {
  const sinkType = getEventForwarderSinkTypeForDatasource(datasource);
  if (!sinkType) return null;

  const existing = await getEventForwarderForDatasource(context, datasource.id);
  return toEventForwarderConfigDraft(existing);
}

export async function getEventForwarderMetadataForDatasource(
  context: ReqContext,
  datasource: Pick<DataSourceInterface, "type" | "id">,
): Promise<EventForwarderConfigWithMetadata | null> {
  const sinkType = getEventForwarderSinkTypeForDatasource(datasource);
  if (!sinkType) return null;

  const existing = await getEventForwarderForDatasource(context, datasource.id);
  return toEventForwarderConfigWithMetadata(existing);
}

export async function syncEventForwarderConfigFromDatasource({
  context,
  datasource,
  draft,
  datasourceParams,
}: {
  context: ReqContext;
  datasource: Pick<
    DataSourceInterface,
    "id" | "organization" | "projects" | "type"
  >;
  draft?: EventForwarderConfigDraft | null;
  datasourceParams?: EventForwarderDatasourceParams;
}): Promise<EventForwarderConfigInterface | null> {
  const sinkType = getEventForwarderSinkTypeForDatasource(datasource);

  if (!sinkType || draft === undefined) {
    return sinkType
      ? getEventForwarderForDatasource(context, datasource.id)
      : null;
  }

  const existing = await getEventForwarderForDatasource(context, datasource.id);

  if (draft === null) {
    if (existing) {
      throw new Error(
        "Cannot remove an Event Forwarder via datasource update. Use DELETE /datasource/:id/event-forwarder instead.",
      );
    }
    return null;
  }

  const normalizedPayload = buildNormalizedSinkPayload(
    draft,
    datasourceParams,
    existing,
  );
  validateNormalizedSinkPayload(draft, datasourceParams, normalizedPayload);

  const projects = [...(datasource.projects ?? [])].sort();

  if (!existing) {
    return await context.models.eventForwarderConfigs.create({
      datasourceId: datasource.id,
      projects,
      topic: getEventForwarderTopicName(datasource.organization, datasource.id),
      // Provisioning resolves the current registry schema id after the topic exists.
      schemaId: 0,
      sinkType: draft.sinkType,
      config: encryptSinkConfig(normalizedPayload),
      status: "pending",
      connectorName: "",
      connectorId: "",
      lastProvisioningError: "",
    });
  }

  return await context.models.eventForwarderConfigs.update(existing, {
    datasourceId: existing.datasourceId || datasource.id,
    projects,
    topic:
      existing.topic ||
      getEventForwarderTopicName(datasource.organization, datasource.id),
    schemaId: existing.schemaId || 0,
    config: encryptSinkConfig(normalizedPayload),
    status: "pending",
    lastProvisioningError: "",
  });
}

export function decryptEventForwarderConfigModel<T extends SinkConfig>(
  config: EventForwarderConfigInterface,
): T {
  return decryptSinkConfig<T>(config.config);
}

/**
 * Re-derives and persists the encrypted sink credential blob for an existing
 * event forwarder config using the latest datasource connection params.
 *
 * Called when `putDatasource` receives updated `params` (connection credentials)
 * but no explicit `eventForwarderConfig` draft — so `syncEventForwarderConfigFromDatasource`
 * would otherwise leave the stored credentials stale.
 *
 * Returns the updated config, or `null` if no config exists for the datasource.
 */
export async function refreshEventForwarderConfigCredentials(
  context: ReqContext,
  datasource: Pick<
    DataSourceInterface,
    "id" | "organization" | "projects" | "type"
  >,
  datasourceParams: EventForwarderDatasourceParams,
): Promise<EventForwarderConfigInterface | null> {
  const existing = await getEventForwarderForDatasource(context, datasource.id);
  if (!existing) {
    return null;
  }

  const draft = toEventForwarderConfigDraft(existing);
  if (!draft) {
    return existing;
  }

  const normalizedPayload = buildNormalizedSinkPayload(
    draft,
    datasourceParams,
    existing,
  );

  return context.models.eventForwarderConfigs.update(existing, {
    config: encryptSinkConfig(normalizedPayload),
    status: "pending",
    lastProvisioningError: "",
  });
}
