import {
  DataSourceType,
  DataSourceInterfaceWithParams,
} from "shared/types/datasource";

export type ParamSensitivity = "secret" | "public";

type ParamScalar =
  | string
  | number
  | boolean
  | bigint
  | symbol
  | Date
  | Uint8Array
  | readonly unknown[];

type FieldClassification<V> = [NonNullable<V>] extends [ParamScalar]
  ? ParamSensitivity
  : [NonNullable<V>] extends [object]
    ? ParamClassification<NonNullable<V>>
    : ParamSensitivity;

export type ParamClassification<T> = {
  [K in keyof T]-?: FieldClassification<T[K]>;
};

type DataSourceParamsByType = {
  [DataSource in DataSourceInterfaceWithParams as DataSource["type"]]: DataSource["params"];
};

export type DataSourceParamsForType<T extends DataSourceType> =
  DataSourceParamsByType[T];

type RedactedValue<Value, Classification> = Classification extends "secret"
  ? ""
  : Classification extends "public"
    ? Value
    : Classification extends object
      ? Value extends object
        ? RedactedObject<Value, Classification>
        : Record<string, never>
      : never;

type RedactedObject<Params, Classification> = {
  [Key in keyof Params as Key extends keyof Classification
    ? Key
    : never]: Key extends keyof Classification
    ? RedactedValue<Params[Key], Classification[Key]>
    : never;
};

type RedactedParams<T extends DataSourceType, P> = P extends object
  ? RedactedObject<P, ParamClassification<DataSourceParamsForType<T>>>
  : Record<string, never>;

// Postgres, Redshift, and Vertica share PostgresConnectionParams.
// Feel free to split them out if needed.
const POSTGRES_FAMILY = {
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
} satisfies ParamClassification<DataSourceParamsForType<"postgres">>;

// Shared by self-hosted `clickhouse` and `growthbook_clickhouse`.
const CLICKHOUSE_FAMILY = {
  host: "public",
  url: "public",
  port: "public",
  user: "public",
  username: "public",
  password: "secret",
  database: "public",
  maxExecutionTime: "public",
} satisfies ParamClassification<DataSourceParamsForType<"clickhouse">>;

const DATA_SOURCE_PARAM_SENSITIVITY = {
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
    options: {
      encrypt: "public",
      trustServerCertificate: "public",
    },
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
    workloadIdentityProvider: "public",
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

  adobe_experience_platform_query_service: {
    host: "public",
    port: "public",
    database: "public",
    username: "public",
    technicalAccountId: "public",
    credential: "secret",
  },
} satisfies {
  [T in DataSourceType]: ParamClassification<DataSourceParamsForType<T>>;
};

// Names from untyped config files that predate the current interfaces.
const LEGACY_SECRET_PARAM_KEYS: ReadonlySet<string> = new Set(["pass"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function redactValue(value: unknown, classification: unknown): unknown {
  if (classification === "secret") return "";
  if (classification === "public") return value;
  return redactRecord(value, classification);
}

function redactRecord(params: unknown, classification: unknown): unknown {
  if (!isRecord(params) || !isRecord(classification)) return {};

  const redacted: Record<string, unknown> = {};
  Object.entries(params).forEach(([key, value]) => {
    if (!(key in classification)) {
      if (LEGACY_SECRET_PARAM_KEYS.has(key)) redacted[key] = "";
      return;
    }

    const redactedValue = redactValue(value, classification[key]);
    if (redactedValue !== undefined) {
      redacted[key] = redactedValue;
    }
  });
  return redacted;
}

export function redactSecretParams<T extends DataSourceType>(
  type: T,
  params: DataSourceParamsForType<T>,
): DataSourceParamsForType<T>;
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

function mergeRecord(
  existing: unknown,
  updates: unknown,
  classification: unknown,
): Record<string, unknown> {
  const merged = isRecord(existing) ? { ...existing } : {};
  if (!isRecord(updates) || !isRecord(classification)) return merged;

  Object.entries(updates).forEach(([key, value]) => {
    if (!(key in classification)) {
      if (LEGACY_SECRET_PARAM_KEYS.has(key) && value) merged[key] = value;
      return;
    }

    const sensitivity = classification[key];
    if (sensitivity === "secret") {
      if (value) merged[key] = value;
      return;
    }
    if (sensitivity === "public") {
      merged[key] = value;
      return;
    }
    merged[key] = mergeRecord(merged[key], value, sensitivity);
  });

  return merged;
}

export function mergeDataSourceParams<T extends DataSourceType>(
  type: T,
  existing: DataSourceParamsForType<T>,
  updates: Partial<DataSourceParamsForType<T>>,
): DataSourceParamsForType<T>;
export function mergeDataSourceParams(
  type: DataSourceType,
  existing: unknown,
  updates: unknown,
): Record<string, unknown>;
export function mergeDataSourceParams(
  type: DataSourceType,
  existing: unknown,
  updates: unknown,
): unknown {
  return mergeRecord(existing, updates, DATA_SOURCE_PARAM_SENSITIVITY[type]);
}

function secretKeysOf(classification: object): string[] {
  return Object.entries(classification)
    .filter(([, sensitivity]) => sensitivity === "secret")
    .map(([key]) => key);
}

function allSecretKeyNames(classification: object): string[] {
  return Object.entries(classification).flatMap(([key, sensitivity]) => {
    if (sensitivity === "secret") return [key];
    return isRecord(sensitivity) ? allSecretKeyNames(sensitivity) : [];
  });
}

/** Param keys that `redactSecretParams` blanks for this datasource type. */
export function secretParamKeys(type: DataSourceType): string[] {
  return secretKeysOf(DATA_SOURCE_PARAM_SENSITIVITY[type]);
}

const SECRET_PARAM_KEYS = new Set(
  Object.values(DATA_SOURCE_PARAM_SENSITIVITY).flatMap(allSecretKeyNames),
);

export function isSecretDatasourceParamKey(key: string): boolean {
  return SECRET_PARAM_KEYS.has(key) || LEGACY_SECRET_PARAM_KEYS.has(key);
}
