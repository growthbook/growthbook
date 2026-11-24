import { AES, enc } from "crypto-js";
import isEqual from "lodash/isEqual";
import { DataSourceInterface } from "shared/types/datasource";
import { BigQueryConnectionParams } from "shared/types/integrations/bigquery";
import { DatabricksConnectionParams } from "shared/types/integrations/databricks";
import { SnowflakeConnectionParams } from "shared/types/integrations/snowflake";
import {
  BigQueryEventForwarderConfigDraft,
  BigQueryEventForwarderStoredConfig,
  DatabricksEventForwarderConfigDraft,
  DatabricksEventForwarderStoredConfig,
  EventForwarderConfigDraft,
  EventForwarderConfigWithMetadata,
  SnowflakeEventForwarderConfigDraft,
  EventForwarderSinkType,
  SnowflakeEventForwarderStoredConfig,
} from "shared/types/event-forwarder";
import { EventForwarderConfigInterface } from "shared/validators";
import {
  DATABRICKS_EVENT_FORWARDER_AUTH_MESSAGE,
  databricksParamsSupportEventForwarder,
  DEFAULT_EVENT_FORWARDER_TABLE_PREFIX,
  EventForwarderDatasourceParams,
  getEventForwarderSinkTypeForDatasource,
  normalizeBigQueryTablePrefixForEventForwarder,
  normalizeDatabricksEventForwarderZerobusEndpoint,
  normalizeDatabricksTablePrefixForEventForwarder,
  normalizeSnowflakeEventForwarderAccessUrl,
  normalizeSnowflakeTablePrefixForEventForwarder,
  normalizeDatabricksEventForwarderDestination,
  resolveBigQueryEventForwarderTableNames,
  resolveSnowflakeEventForwarderTableNames,
  resolveDatabricksEventForwarderTables,
} from "shared/util";
import { ReqContext } from "back-end/types/request";
import { ENCRYPTION_KEY } from "back-end/src/util/secrets";
import { EVENT_FORWARDER_ENVIRONMENT_INDEX } from "back-end/src/models/EventForwarderConfigModel";
import { getEnvironmentIdsFromOrg } from "back-end/src/util/organization.util";

type SinkConfig =
  | BigQueryEventForwarderStoredConfig
  | SnowflakeEventForwarderStoredConfig
  | DatabricksEventForwarderStoredConfig;

// Sinks written by a GrowthBook-run consumer on one shared topic per sink,
// instead of a per-datasource Confluent connector.
const IN_HOUSE_CONSUMER_SINKS: ReadonlySet<EventForwarderSinkType> = new Set([
  "databricks",
  "bigquery",
  "snowflake",
]);

export function isInHouseConsumerSink(
  sinkType: EventForwarderSinkType,
): boolean {
  return IN_HOUSE_CONSUMER_SINKS.has(sinkType);
}

// Whether an existing config is on the consumer: new configs get the shared
// topic (or a per-org `__<orgId>` override); BigQuery configs created before
// the consumer kept their per-datasource Confluent topic.
// TODO: once every pre-consumer config is torn down, isInHouseConsumerSink suffices.
export function isInHouseConsumerTopic(
  topic: string,
  sinkType: EventForwarderSinkType,
): boolean {
  return topic.split("__")[0] === getInHouseConsumerTopicName(sinkType);
}

export function getInHouseConsumerTopicName(
  sinkType: EventForwarderSinkType,
): string {
  return `event_forwarder_${sinkType}`;
}

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

function emptyStoredConfig(sinkType: EventForwarderSinkType): SinkConfig {
  const tables = {
    events: "",
    experiment_viewed: "",
    feature_usage: "",
  };
  switch (sinkType) {
    case "bigquery":
      return {
        projectId: "",
        dataset: "",
        tablePrefix: "",
        serviceAccountKey: "",
        tables,
      };
    case "snowflake":
      return {
        tablePrefix: "",
        tables,
        account: "",
        username: "",
        database: "",
        schema: "",
        privateKey: "",
      };
    case "databricks":
      return {
        catalog: "",
        schema: "",
        tablePrefix: "",
        zerobusEndpoint: "",
        tables,
        host: "",
        path: "",
        oauthClientId: "",
        oauthClientSecret: "",
      };
  }
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

export function getDatabricksEventForwarderTablePrefix(
  config: DatabricksEventForwarderStoredConfig,
): string {
  return normalizeDatabricksTablePrefixForEventForwarder(config.tablePrefix);
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

// Rows that never got a destination or a connector receive nothing
function hasNeverReceivedEvents(c: EventForwarderConfigInterface): boolean {
  return (
    c.status === "unconfigured" || (c.status === "error" && !c.connectorName)
  );
}

// What the overlap check holds against other forwarders; "" is all environments.
// Org-wide (not sensitive), so the UI can rule choices out before a save.
export function getClaimedEventForwarderEnvironments(
  configs: EventForwarderConfigInterface[],
): {
  datasourceId: string;
  environment: string;
  region: "us-east-1" | "eu-west-1";
}[] {
  return configs
    .filter((c) => c.environments?.length || !hasNeverReceivedEvents(c))
    .flatMap((c) =>
      // One entry per environment
      (c.environments?.length ? c.environments : [""]).map((environment) => ({
        datasourceId: c.datasourceId,
        environment,
        region: c.region ?? ("us-east-1" as const),
      })),
    );
}

// Without blanks or repeats; empty means all environments
export function normalizeEventForwarderEnvironments(
  environments: string[] | undefined,
): string[] {
  return [...new Set((environments ?? []).filter(Boolean))];
}

const environmentTakenMessage = (environments: string[]) =>
  environments.length === 1
    ? `Another Event Forwarder in this data region already receives the "${environments[0]}" environment.`
    : `Another Event Forwarder in this data region already receives one of these environments: ${environments.join(", ")}.`;

// Turns a lost race on the unique environment index into the usual message
async function claimingEnvironment<T>(
  environments: string[],
  write: () => Promise<T>,
): Promise<T> {
  try {
    return await write();
  } catch (e) {
    if (
      environments.length &&
      e instanceof Error &&
      "code" in e &&
      e.code === 11000 &&
      e.message.includes(EVENT_FORWARDER_ENVIRONMENT_INDEX)
    ) {
      throw new Error(environmentTakenMessage(environments));
    }
    throw e;
  }
}

// A forwarder that has received events keeps its environments: changing them
// would send another environment's events into the same tables
// - All environments can still be narrowed
// - Environments deleted from the organization can be replaced
export function assertEventForwarderEnvironmentUnchanged(
  context: ReqContext,
  existing: EventForwarderConfigInterface | null | undefined,
  environments: string[] | undefined,
): void {
  const saved = existing?.environments ?? [];
  const next = normalizeEventForwarderEnvironments(environments);
  const known = getEnvironmentIdsFromOrg(context.org);
  if (
    !existing ||
    !saved.length ||
    (saved.length === next.length && saved.every((e) => next.includes(e))) ||
    hasNeverReceivedEvents(existing) ||
    saved.some((e) => !known.includes(e))
  ) {
    return;
  }
  throw new Error(
    saved.length === 1
      ? `This Event Forwarder is set to the "${saved[0]}" environment, which cannot be changed. To use a different environment, delete it and set up a new one.`
      : `This Event Forwarder is set to these environments, which cannot be changed: ${saved.join(", ")}. To use different environments, delete it and set up a new one.`,
  );
}

// Rules apply per data region: each regional ingestor only sees its own forwarders
// - No two forwarders may receive the same environment (events and usage would double)
// - A forwarder may list several environments; each one counts
// - No environments means all of them, which only a lone forwarder may have
// - Rows that never received events only conflict on the same environment (unique index)
// - Org-wide, so forwarders on unreadable Projects count
export async function assertNoEventForwarderEnvironmentOverlap(
  context: ReqContext,
  environments: string[] | undefined,
  {
    current,
    adding = !current,
    allowUnset = false,
    region,
  }: {
    // Row being updated or migrated
    current?: EventForwarderConfigInterface | null;
    // Starts receiving events with this save (new, or never set up before)
    adding?: boolean;
    // Environment is picked later (unconfigured row)
    allowUnset?: boolean;
    // Data region of a forwarder being created; otherwise `current`'s
    region?: "us-east-1" | "eu-west-1";
  } = {},
): Promise<void> {
  const wanted = normalizeEventForwarderEnvironments(environments);
  const known = getEnvironmentIdsFromOrg(context.org);
  const missing = wanted.find((e) => !known.includes(e));
  if (missing) {
    throw new Error(`Cannot find environment "${missing}".`);
  }
  const ownRegion = region ?? current?.region ?? "us-east-1";
  const all = (
    await context.models.eventForwarderConfigs.getAllBypassingReadPermissions()
  ).filter(
    (c) => c.id !== current?.id && (c.region ?? "us-east-1") === ownRegion,
  );
  const taken = wanted.filter((e) =>
    all.some((c) => c.environments?.includes(e)),
  );
  if (taken.length) {
    throw new Error(environmentTakenMessage(taken));
  }
  // Alone, a forwarder may receive all environments
  const others = all.filter((c) => !hasNeverReceivedEvents(c));
  if (!others.length) return;

  if (adding) {
    if (others.some((c) => !c.environments?.length)) {
      throw new Error(
        "Another Event Forwarder in this data region receives all environments. Set it to one environment first, so events are not sent twice.",
      );
    }
    if (!wanted.length && !allowUnset) {
      throw new Error(
        "Choose an environment. This data region has another Event Forwarder.",
      );
    }
  } else if (!wanted.length && current?.environments?.length) {
    throw new Error(
      "Choose an environment. This data region has another Event Forwarder.",
    );
  }
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

function parseBigQueryServiceAccountKey(raw: string): {
  project_id?: string;
  client_email?: string;
  private_key?: string;
} | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error("Event Forwarder service account key is not valid JSON.");
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Event Forwarder service account key is not valid JSON.");
  }

  return parsed;
}

export function getEventForwarderBigQueryConnectionParams(
  params: BigQueryConnectionParams,
  serviceAccountKeyJson: string | undefined,
): BigQueryConnectionParams {
  const serviceAccountKey = parseBigQueryServiceAccountKey(
    serviceAccountKeyJson || "",
  );
  if (!serviceAccountKey) return params;

  return {
    ...params,
    authType: "json",
    projectId: serviceAccountKey.project_id || params.projectId,
    defaultProject:
      params.defaultProject ||
      serviceAccountKey.project_id ||
      params.projectId ||
      "",
    clientEmail: serviceAccountKey.client_email || params.clientEmail,
    privateKey: serviceAccountKey.private_key || params.privateKey,
    serviceAccountJson: serviceAccountKeyJson,
  };
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

  const names = resolveBigQueryEventForwarderTableNames(tablePrefix);
  return {
    projectId,
    dataset,
    tablePrefix,
    serviceAccountKey,
    tables: {
      events: names.events,
      experiment_viewed: names.experimentViewed,
      feature_usage: names.featureUsage,
    },
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
      "Snowflake event forwarder requires key-pair authentication. Password and Workload Identity authentication are supported for Snowflake queries, but Snowpipe Streaming requires a private key.",
    );
  }

  const names = resolveSnowflakeEventForwarderTableNames(tablePrefix);
  return {
    tablePrefix,
    tables: {
      events: names.events,
      experiment_viewed: names.experimentViewed,
      feature_usage: names.featureUsage,
    },
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

function buildDatabricksStoredConfigFromDraft(
  draft: DatabricksEventForwarderConfigDraft,
  datasourceParams: DatabricksConnectionParams | undefined,
  existingModel: EventForwarderConfigInterface | null,
): DatabricksEventForwarderStoredConfig {
  const existingStored =
    existingModel?.sinkType === "databricks"
      ? decryptSinkConfig<DatabricksEventForwarderStoredConfig>(
          existingModel.config,
        )
      : null;

  if (!databricksParamsSupportEventForwarder(datasourceParams)) {
    throw new Error(DATABRICKS_EVENT_FORWARDER_AUTH_MESSAGE);
  }

  const catalog =
    draft.catalog?.trim() ||
    existingStored?.catalog?.trim() ||
    datasourceParams?.catalog?.trim() ||
    "";
  const schema = draft.schema?.trim() || existingStored?.schema?.trim() || "";
  // Same per-field validation as the UI.
  const destination = normalizeDatabricksEventForwarderDestination({
    catalog,
    schema,
    tablePrefix: draft.tablePrefix ?? "",
  });

  let zerobusEndpoint = existingStored?.zerobusEndpoint?.trim() || "";
  if (draft.zerobusEndpoint?.trim()) {
    zerobusEndpoint = normalizeDatabricksEventForwarderZerobusEndpoint(
      draft.zerobusEndpoint,
    );
  }

  return {
    ...destination,
    zerobusEndpoint,
    tables: resolveDatabricksEventForwarderTables(destination),
    host: datasourceParams?.host?.trim() || existingStored?.host?.trim() || "",
    path: datasourceParams?.path?.trim() || existingStored?.path?.trim() || "",
    oauthClientId:
      datasourceParams?.oauthClientId?.trim() ||
      existingStored?.oauthClientId?.trim() ||
      "",
    oauthClientSecret:
      datasourceParams?.oauthClientSecret?.trim() ||
      existingStored?.oauthClientSecret?.trim() ||
      "",
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
    case "databricks":
      return buildDatabricksStoredConfigFromDraft(
        draft.config,
        datasourceParams as DatabricksConnectionParams | undefined,
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
        "Snowflake event forwarder requires account, username, destination table prefix (DATABASE.SCHEMA.PREFIX), Snowflake URL, private key credentials, and Snowflake role",
      );
    }
  }

  if (draft.sinkType === "databricks") {
    const databricks =
      normalizedPayload as DatabricksEventForwarderStoredConfig;
    if (
      !databricks.catalog ||
      !databricks.schema ||
      !getDatabricksEventForwarderTablePrefix(databricks) ||
      !databricks.zerobusEndpoint ||
      !databricks.host ||
      !databricks.path ||
      !databricks.oauthClientId ||
      !databricks.oauthClientSecret
    ) {
      throw new Error(
        "Databricks event forwarder requires destination (catalog.schema.prefix), Zerobus endpoint, and a Databricks OAuth connection (host, HTTP path, client ID, secret)",
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
  const environments = config.environments?.length
    ? { environments: config.environments }
    : {};

  switch (config.sinkType) {
    case "bigquery": {
      const decrypted = decryptSinkConfig<
        BigQueryEventForwarderStoredConfig & { projectId?: string }
      >(config.config);
      return {
        sinkType: "bigquery",
        region: config.region,
        ...environments,
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
        region: config.region,
        ...environments,
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
    case "databricks": {
      const decrypted = decryptSinkConfig<DatabricksEventForwarderStoredConfig>(
        config.config,
      );
      return {
        sinkType: "databricks",
        region: config.region,
        ...environments,
        config: {
          catalog: decrypted.catalog || "",
          schema: decrypted.schema || "",
          tablePrefix: getDatabricksEventForwarderTablePrefix(decrypted),
          zerobusEndpoint: decrypted.zerobusEndpoint || "",
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
  // Conditional, since isEqual treats an undefined key as a difference
  const environments = draft.environments?.length
    ? { environments: draft.environments }
    : {};
  switch (draft.sinkType) {
    case "bigquery":
      return { sinkType: "bigquery", config: draft.config, ...environments };
    case "snowflake":
      return { sinkType: "snowflake", config: draft.config, ...environments };
    case "databricks":
      return { sinkType: "databricks", config: draft.config, ...environments };
  }
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
    inHouseConsumer: isInHouseConsumerTopic(config.topic, config.sinkType),
  };
}

// Super admin: changes only which environments a forwarder receives, on
// either transport. Nothing to re-provision: the ingestor routes by it.
// - Not held by the environment lock: may switch between environments
// - All environments only for the organization's only forwarder
// - Otherwise the usual overlap check (no shared environment in a region)
export async function setEventForwarderEnvironments(
  context: ReqContext,
  existing: EventForwarderConfigInterface,
  requestedEnvironments: string[],
): Promise<EventForwarderConfigInterface> {
  const environments = normalizeEventForwarderEnvironments(
    requestedEnvironments,
  );
  if (!environments.length) {
    const others = (
      await context.models.eventForwarderConfigs.getAllBypassingReadPermissions()
    ).filter((c) => c.id !== existing.id);
    if (others.length) {
      throw new Error(
        "All environments is only allowed for the organization's only Event Forwarder. Choose an environment.",
      );
    }
  } else {
    await assertNoEventForwarderEnvironmentOverlap(context, environments, {
      current: existing,
      adding: true,
    });
  }
  const updated = await claimingEnvironment(environments, () =>
    context.models.eventForwarderConfigs.updateWithCas(
      existing.id,
      ["environments", "status"],
      () => ({ environments }),
    ),
  );
  if (!updated) {
    throw new Error("Cannot find event forwarder config");
  }
  return updated;
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

export async function createUnconfiguredEventForwarderConfig({
  context,
  datasource,
  region,
}: {
  context: ReqContext;
  datasource: Pick<
    DataSourceInterface,
    "id" | "organization" | "projects" | "type"
  >;
  region: "us-east-1" | "eu-west-1";
}): Promise<EventForwarderConfigInterface | null> {
  const sinkType = getEventForwarderSinkTypeForDatasource(datasource);
  if (!sinkType) {
    return null;
  }

  const existing = await getEventForwarderForDatasource(context, datasource.id);
  if (existing) {
    return existing;
  }

  return context.models.eventForwarderConfigs.create({
    datasourceId: datasource.id,
    projects: [...(datasource.projects ?? [])].sort(),
    topic: isInHouseConsumerSink(sinkType)
      ? getInHouseConsumerTopicName(sinkType)
      : getEventForwarderTopicName(datasource.organization, datasource.id),
    schemaId: 0,
    sinkType,
    region,
    config: encryptSinkConfig(emptyStoredConfig(sinkType)),
    status: "unconfigured",
    connectorName: "",
    connectorId: "",
    lastProvisioningError: "",
  });
}

// The Data Source already exists. Keep a config row so the Data Source page
// can show the failure instead of looking like a normal warehouse connection.
export async function recordEventForwarderCreateFailure({
  context,
  datasource,
  region,
  message,
}: {
  context: ReqContext;
  datasource: Pick<
    DataSourceInterface,
    "id" | "organization" | "projects" | "type"
  >;
  region: "us-east-1" | "eu-west-1";
  message: string;
}): Promise<void> {
  const existing =
    (await getEventForwarderForDatasource(context, datasource.id)) ??
    (await createUnconfiguredEventForwarderConfig({
      context,
      datasource,
      region,
    }));
  if (!existing) return;

  await context.models.eventForwarderConfigs.update(existing, {
    status: "error",
    lastProvisioningError: message,
  });
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

  const environments = normalizeEventForwarderEnvironments(draft.environments);
  assertEventForwarderEnvironmentUnchanged(context, existing, environments);
  await assertNoEventForwarderEnvironmentOverlap(context, environments, {
    current: existing,
    adding: !existing || hasNeverReceivedEvents(existing),
    region: existing ? undefined : (draft.region ?? "us-east-1"),
  });

  if (!existing) {
    return await claimingEnvironment(environments, () =>
      context.models.eventForwarderConfigs.create({
        datasourceId: datasource.id,
        projects,
        environments,
        topic: isInHouseConsumerSink(draft.sinkType)
          ? getInHouseConsumerTopicName(draft.sinkType)
          : getEventForwarderTopicName(datasource.organization, datasource.id),
        // Provisioning resolves the current registry schema id after the topic exists.
        schemaId: 0,
        sinkType: draft.sinkType,
        region: draft.region ?? "us-east-1",
        config: encryptSinkConfig(normalizedPayload),
        status: "pending",
        connectorName: "",
        connectorId: "",
        lastProvisioningError: "",
      }),
    );
  }

  // Guarded on the row just checked, so a concurrent save can't slip past the lock
  return await claimingEnvironment(environments, () =>
    context.models.eventForwarderConfigs.updateIfUnchanged(existing, {
      datasourceId: existing.datasourceId || datasource.id,
      projects,
      topic:
        existing.topic ||
        getEventForwarderTopicName(datasource.organization, datasource.id),
      schemaId: existing.schemaId || 0,
      environments,
      config: encryptSinkConfig(normalizedPayload),
      status: "pending",
      lastProvisioningError: "",
    }),
  );
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
