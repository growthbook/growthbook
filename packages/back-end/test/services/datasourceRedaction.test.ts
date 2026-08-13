import {
  DataSourceInterface,
  DataSourceParams,
  DataSourceType,
} from "shared/types/datasource";
import {
  encryptParams,
  getNonSensitiveParams,
  getSourceIntegrationObject,
  mergeParams,
} from "back-end/src/services/datasource";
import { ReqContext } from "back-end/types/request";

// Listed independently of the app's classification table so this cannot pass by
// agreeing with itself. Certs count as credentials.
const CREDENTIAL_FIELDS: Record<DataSourceType, string[]> = {
  postgres: ["password", "caCert", "clientCert", "clientKey"],
  redshift: ["password", "caCert", "clientCert", "clientKey"],
  vertica: ["password", "caCert", "clientCert", "clientKey"],
  mysql: ["password", "caCert", "clientCert", "clientKey"],
  mssql: ["password"],
  bigquery: ["privateKey", "serviceAccountJson"],
  athena: ["accessKeyId", "secretAccessKey"],
  presto: ["password", "customAuth", "caCert", "clientCert", "clientKey"],
  databricks: ["token", "oauthClientSecret"],
  snowflake: ["password", "privateKey", "privateKeyPassword"],
  mixpanel: ["secret"],
  google_analytics: ["refreshToken"],
  clickhouse: ["password"],
  growthbook_clickhouse: ["password"],
  adobe_ep_query_service: ["credential"],
};

// A param that must survive redaction, so blanking everything cannot pass.
const PUBLIC_FIELD: Record<DataSourceType, string> = {
  postgres: "host",
  redshift: "host",
  vertica: "host",
  mysql: "host",
  mssql: "server",
  bigquery: "defaultDataset",
  athena: "bucketUri",
  presto: "catalog",
  databricks: "path",
  snowflake: "account",
  mixpanel: "projectId",
  google_analytics: "viewId",
  clickhouse: "database",
  growthbook_clickhouse: "database",
  adobe_ep_query_service: "sandbox",
};

const value = (type: DataSourceType, field: string) =>
  `secret.${type}.${field}`;

const postgresLike = (type: DataSourceType) => ({
  user: value(type, "user"),
  host: value(type, "host"),
  database: value(type, "database"),
  password: value(type, "password"),
  port: 5432,
  ssl: false,
  defaultSchema: value(type, "defaultSchema"),
  caCert: value(type, "caCert"),
  clientCert: value(type, "clientCert"),
  clientKey: value(type, "clientKey"),
});

const clickHouseLike = (type: DataSourceType) => ({
  host: value(type, "host"),
  url: value(type, "url"),
  port: 8123,
  user: value(type, "user"),
  username: value(type, "username"),
  password: value(type, "password"),
  database: value(type, "database"),
  maxExecutionTime: 60,
});

const PARAMS: Record<DataSourceType, DataSourceParams> = {
  postgres: postgresLike("postgres"),
  redshift: postgresLike("redshift"),
  vertica: postgresLike("vertica"),
  mysql: {
    user: value("mysql", "user"),
    host: value("mysql", "host"),
    database: value("mysql", "database"),
    password: value("mysql", "password"),
    port: 3306,
    ssl: false,
    caCert: value("mysql", "caCert"),
    clientCert: value("mysql", "clientCert"),
    clientKey: value("mysql", "clientKey"),
  },
  mssql: {
    user: value("mssql", "user"),
    server: value("mssql", "server"),
    database: value("mssql", "database"),
    password: value("mssql", "password"),
    port: 1433,
    defaultSchema: value("mssql", "defaultSchema"),
    requestTimeout: 30,
    options: { encrypt: true, trustServerCertificate: false },
  },
  bigquery: {
    authType: "json",
    projectId: value("bigquery", "projectId"),
    clientEmail: value("bigquery", "clientEmail"),
    privateKey: value("bigquery", "privateKey"),
    serviceAccountJson: value("bigquery", "serviceAccountJson"),
    reservation: value("bigquery", "reservation"),
    defaultProject: value("bigquery", "defaultProject"),
    defaultDataset: value("bigquery", "defaultDataset"),
  },
  athena: {
    authType: "accessKey",
    accessKeyId: value("athena", "accessKeyId"),
    secretAccessKey: value("athena", "secretAccessKey"),
    assumeRoleARN: value("athena", "assumeRoleARN"),
    roleSessionName: value("athena", "roleSessionName"),
    durationSeconds: 900,
    externalId: value("athena", "externalId"),
    region: value("athena", "region"),
    database: value("athena", "database"),
    bucketUri: value("athena", "bucketUri"),
    workGroup: value("athena", "workGroup"),
    catalog: value("athena", "catalog"),
    resultReuseMaxAgeInMinutes: value("athena", "resultReuseMaxAgeInMinutes"),
  },
  presto: {
    authType: "customAuth",
    engine: "trino",
    host: value("presto", "host"),
    port: 8080,
    user: value("presto", "user"),
    trinoUser: value("presto", "trinoUser"),
    username: value("presto", "username"),
    password: value("presto", "password"),
    customAuth: value("presto", "customAuth"),
    kerberosServicePrincipal: value("presto", "kerberosServicePrincipal"),
    kerberosClientPrincipal: value("presto", "kerberosClientPrincipal"),
    kerberosUser: value("presto", "kerberosUser"),
    source: value("presto", "source"),
    catalog: value("presto", "catalog"),
    schema: value("presto", "schema"),
    ssl: false,
    caCert: value("presto", "caCert"),
    clientCert: value("presto", "clientCert"),
    clientKey: value("presto", "clientKey"),
    requestTimeout: 30,
  },
  databricks: {
    authType: "oauth-m2m",
    token: value("databricks", "token"),
    oauthClientId: value("databricks", "oauthClientId"),
    oauthClientSecret: value("databricks", "oauthClientSecret"),
    host: value("databricks", "host"),
    port: 443,
    path: value("databricks", "path"),
    catalog: value("databricks", "catalog"),
    clientId: value("databricks", "clientId"),
  },
  snowflake: {
    account: value("snowflake", "account"),
    accessUrl: value("snowflake", "accessUrl"),
    username: value("snowflake", "username"),
    password: value("snowflake", "password"),
    database: value("snowflake", "database"),
    schema: value("snowflake", "schema"),
    role: value("snowflake", "role"),
    warehouse: value("snowflake", "warehouse"),
    authMethod: "key-pair",
    privateKey: value("snowflake", "privateKey"),
    privateKeyPassword: value("snowflake", "privateKeyPassword"),
  },
  mixpanel: {
    username: value("mixpanel", "username"),
    secret: value("mixpanel", "secret"),
    projectId: value("mixpanel", "projectId"),
    server: "standard",
  },
  google_analytics: {
    customDimension: value("google_analytics", "customDimension"),
    refreshToken: value("google_analytics", "refreshToken"),
    viewId: value("google_analytics", "viewId"),
    delimiter: value("google_analytics", "delimiter"),
  },
  clickhouse: clickHouseLike("clickhouse"),
  growthbook_clickhouse: clickHouseLike("growthbook_clickhouse"),
  adobe_ep_query_service: {
    host: value("adobe_ep_query_service", "host"),
    port: 5432,
    orgId: value("adobe_ep_query_service", "orgId"),
    sandbox: value("adobe_ep_query_service", "sandbox"),
    container: value("adobe_ep_query_service", "container"),
    flatten: false,
    technicalAccountId: value("adobe_ep_query_service", "technicalAccountId"),
    credential: value("adobe_ep_query_service", "credential"),
  },
};

const TYPES = Object.keys(PARAMS) as DataSourceType[];

// @ts-expect-error -- redaction does not read the request context
const context: ReqContext = {};

function integrationFor(type: DataSourceType) {
  const datasource: DataSourceInterface = {
    id: `ds_${type}`,
    name: type,
    description: "",
    organization: "org_redaction",
    type,
    settings: {},
    dateCreated: new Date(),
    dateUpdated: new Date(),
    params: encryptParams(PARAMS[type]),
    projects: [],
  };
  return getSourceIntegrationObject(context, datasource);
}

describe("datasource connection param redaction", () => {
  it.each(TYPES)("blanks every credential field for %s", (type) => {
    const returned = getNonSensitiveParams(integrationFor(type));

    const exposed = CREDENTIAL_FIELDS[type].filter(
      (field) => returned[field] !== "",
    );
    expect(exposed).toEqual([]);
  });

  it.each(TYPES)("still returns non-credential params for %s", (type) => {
    const returned = getNonSensitiveParams(integrationFor(type));
    const field = PUBLIC_FIELD[type];

    expect(returned[field]).toBe(value(type, field));
  });

  it.each(TYPES)(
    "keeps the stored credential when %s saves it back blank",
    (type) => {
      const integration = integrationFor(type);
      const roundTripped = getNonSensitiveParams(integration);

      mergeParams(integration, roundTripped);

      CREDENTIAL_FIELDS[type].forEach((field) => {
        expect(integration.params[field]).toBe(value(type, field));
      });
    },
  );
});
