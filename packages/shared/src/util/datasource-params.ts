import {
  DataSourceType,
  DataSourceInterfaceWithParams,
} from "shared/types/datasource";

type ParamSensitivity = "secret" | "public";

type FieldSensitivity<V> = [NonNullable<V>] extends [string]
  ? ParamSensitivity
  : "public";

type ParamClassification<T> = {
  [K in keyof T]-?: FieldSensitivity<T[K]>;
};

export type DataSourceParamsForType<T extends DataSourceType> = Extract<
  DataSourceInterfaceWithParams,
  { type: T }
>["params"];

type RedactedParams<T extends DataSourceType, P> = 0 extends 1 & P
  ? P
  : Pick<P, Extract<keyof P, keyof DataSourceParamsForType<T>>>;

// Postgres, Redshift, and Vertica share PostgresConnectionParams.
// Feel free to split them out if needed.
const POSTGRES_FAMILY: ParamClassification<
  DataSourceParamsForType<"postgres">
> = {
  user: "public",
  host: "public",
  database: "public",
  password: "secret",
  port: "public",
  ssl: "public",
  defaultSchema: "public",
  caCert: "secret",
  clientCert: "secret",
  clientKey: "secret",
};

// Shared by self-hosted `clickhouse` and `growthbook_clickhouse`.
const CLICKHOUSE_FAMILY: ParamClassification<
  DataSourceParamsForType<"clickhouse">
> = {
  host: "public",
  url: "public",
  port: "public",
  user: "public",
  username: "public",
  password: "secret",
  database: "public",
  maxExecutionTime: "public",
};

const DATA_SOURCE_PARAM_SENSITIVITY: {
  [T in DataSourceType]: ParamClassification<DataSourceParamsForType<T>>;
} = {
  postgres: POSTGRES_FAMILY,
  redshift: POSTGRES_FAMILY,
  vertica: POSTGRES_FAMILY,

  clickhouse: CLICKHOUSE_FAMILY,
  growthbook_clickhouse: CLICKHOUSE_FAMILY,

  mysql: {
    user: "public",
    host: "public",
    database: "public",
    password: "secret",
    port: "public",
    ssl: "public",
    caCert: "secret",
    clientCert: "secret",
    clientKey: "secret",
  },

  mssql: {
    user: "public",
    server: "public",
    database: "public",
    password: "secret",
    port: "public",
    defaultSchema: "public",
    requestTimeout: "public",
    options: "public",
  },

  bigquery: {
    authType: "public",
    projectId: "public",
    clientEmail: "public",
    privateKey: "secret",
    serviceAccountJson: "secret",
    reservation: "public",
    defaultProject: "public",
    defaultDataset: "public",
  },

  athena: {
    authType: "public",
    accessKeyId: "secret",
    secretAccessKey: "secret",
    assumeRoleARN: "public",
    roleSessionName: "public",
    durationSeconds: "public",
    externalId: "public",
    region: "public",
    database: "public",
    bucketUri: "public",
    workGroup: "public",
    catalog: "public",
    resultReuseMaxAgeInMinutes: "public",
  },

  presto: {
    authType: "public",
    engine: "public",
    host: "public",
    port: "public",
    user: "public",
    trinoUser: "public",
    username: "public",
    password: "secret",
    customAuth: "secret",
    // Principal names, not keytabs.
    kerberosServicePrincipal: "public",
    kerberosClientPrincipal: "public",
    kerberosUser: "public",
    source: "public",
    catalog: "public",
    schema: "public",
    ssl: "public",
    caCert: "secret",
    clientCert: "secret",
    clientKey: "secret",
    requestTimeout: "public",
  },

  databricks: {
    authType: "public",
    token: "secret",
    oauthClientId: "public",
    oauthClientSecret: "secret",
    host: "public",
    port: "public",
    path: "public",
    catalog: "public",
    clientId: "public",
  },

  snowflake: {
    account: "public",
    accessUrl: "public",
    username: "public",
    password: "secret",
    database: "public",
    schema: "public",
    role: "public",
    warehouse: "public",
    authMethod: "public",
    privateKey: "secret",
    privateKeyPassword: "secret",
  },

  mixpanel: {
    username: "public",
    secret: "secret",
    projectId: "public",
    server: "public",
  },

  google_analytics: {
    customDimension: "public",
    refreshToken: "secret",
    viewId: "public",
    delimiter: "public",
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function redactRecord(params: unknown, classification: unknown): unknown {
  if (!isRecord(params) || !isRecord(classification)) return {};

  const redacted: Record<string, unknown> = {};
  Object.entries(params).forEach(([key, value]) => {
    const sensitivity = classification[key];
    if (sensitivity === "secret") {
      redacted[key] = "";
    } else if (sensitivity === "public") {
      redacted[key] = value;
    }
    // Unclassified keys are dropped so stale stored fields cannot reach a client.
  });
  return redacted;
}

export function redactSecretParams<
  T extends DataSourceType,
  P extends Partial<DataSourceParamsForType<T>>,
>(type: T, params: P): RedactedParams<T, P>;
export function redactSecretParams(
  type: DataSourceType,
  params: unknown,
): unknown {
  return redactRecord(params, DATA_SOURCE_PARAM_SENSITIVITY[type]);
}

function secretKeysOf(classification: object): string[] {
  return Object.entries(classification)
    .filter(([, sensitivity]) => sensitivity === "secret")
    .map(([key]) => key);
}

/** Param keys that `redactSecretParams` blanks for this datasource type. */
export function secretParamKeys(type: DataSourceType): string[] {
  return secretKeysOf(DATA_SOURCE_PARAM_SENSITIVITY[type]);
}

const SECRET_PARAM_KEYS = new Set(
  Object.values(DATA_SOURCE_PARAM_SENSITIVITY).flatMap(secretKeysOf),
);

// Names from untyped config files that predate the current interfaces.
const LEGACY_SECRET_PARAM_KEYS: ReadonlySet<string> = new Set(["pass"]);

export function isSecretDatasourceParamKey(key: string): boolean {
  return SECRET_PARAM_KEYS.has(key) || LEGACY_SECRET_PARAM_KEYS.has(key);
}
