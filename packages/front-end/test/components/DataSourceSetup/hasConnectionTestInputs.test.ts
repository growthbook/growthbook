import { beforeEach, describe, expect, it, vi } from "vitest";
import { DataSourceType } from "shared/types/datasource";
import { hasConnectionTestInputs } from "@/components/DataSourceSetup/hasConnectionTestInputs";

const cloud = vi.hoisted(() => ({ value: false }));

vi.mock("@/services/env", () => ({
  isCloud: () => cloud.value,
}));

function canTest(
  type: DataSourceType | undefined,
  params: object | undefined,
  keepStoredSecrets = false,
): boolean {
  return hasConnectionTestInputs(type, params, keepStoredSecrets);
}

describe("hasConnectionTestInputs", () => {
  beforeEach(() => {
    cloud.value = false;
  });

  it("requires a datasource type", () => {
    expect(canTest(undefined, { host: "db.example" })).toBe(false);
  });

  describe("bigquery", () => {
    const credentials = {
      projectId: "analytics",
      clientEmail: "svc@analytics.iam.gserviceaccount.com",
      privateKey: "key",
    };

    it("accepts a service account key", () => {
      expect(canTest("bigquery", credentials)).toBe(true);
    });

    it("requires the private key on a new connection", () => {
      expect(canTest("bigquery", { ...credentials, privateKey: "  " })).toBe(
        false,
      );
    });

    it("keeps a saved private key", () => {
      expect(
        canTest("bigquery", { ...credentials, privateKey: "" }, true),
      ).toBe(true);
    });

    it("still requires the project and client email when the key is saved", () => {
      expect(
        canTest(
          "bigquery",
          { clientEmail: credentials.clientEmail, privateKey: "" },
          true,
        ),
      ).toBe(false);
    });

    it("allows application default credentials when self-hosted", () => {
      expect(canTest("bigquery", { authType: "auto" })).toBe(true);
    });

    it("requires a service account key for application default credentials on Cloud", () => {
      cloud.value = true;
      expect(canTest("bigquery", { authType: "auto" })).toBe(false);
      expect(canTest("bigquery", { ...credentials, authType: "auto" })).toBe(
        true,
      );
    });
  });

  describe("snowflake", () => {
    const identity = {
      account: "xy12345.us-east-1",
      username: "GROWTHBOOK",
      database: "ANALYTICS",
      schema: "PUBLIC",
    };

    it("defaults a new connection to key-pair authentication", () => {
      expect(canTest("snowflake", { ...identity, password: "pw" })).toBe(false);
      expect(canTest("snowflake", { ...identity, privateKey: "key" })).toBe(
        true,
      );
    });

    it("requires the private key for key-pair authentication", () => {
      expect(
        canTest("snowflake", { ...identity, authMethod: "key-pair" }),
      ).toBe(false);
      expect(
        canTest("snowflake", {
          ...identity,
          authMethod: "key-pair",
          privateKey: "key",
        }),
      ).toBe(true);
    });

    it("keeps a saved private key", () => {
      expect(
        canTest("snowflake", { ...identity, authMethod: "key-pair" }, true),
      ).toBe(true);
    });

    it("requires the password for password authentication", () => {
      expect(
        canTest("snowflake", { ...identity, authMethod: "password" }),
      ).toBe(false);
      expect(
        canTest("snowflake", {
          ...identity,
          authMethod: "password",
          password: "pw",
        }),
      ).toBe(true);
    });

    it("keeps a saved password and defaults a saved connection to password authentication", () => {
      expect(
        canTest("snowflake", { ...identity, authMethod: "password" }, true),
      ).toBe(true);
      expect(canTest("snowflake", identity, true)).toBe(true);
    });

    it("requires the workload identity provider", () => {
      expect(
        canTest("snowflake", {
          ...identity,
          authMethod: "workload-identity",
          privateKey: "key",
        }),
      ).toBe(false);
      expect(
        canTest("snowflake", {
          ...identity,
          authMethod: "workload-identity",
          workloadIdentityProvider: "arn:aws:iam::123:oidc-provider/example",
        }),
      ).toBe(true);
    });

    it("requires the account, user, database, and schema", () => {
      expect(
        canTest("snowflake", { ...identity, schema: "", privateKey: "key" }),
      ).toBe(false);
    });
  });

  describe("databricks", () => {
    const connection = { host: "adb.cloud.databricks.com", path: "/sql/1.0" };

    it("defaults to a personal access token", () => {
      expect(canTest("databricks", connection)).toBe(false);
      expect(canTest("databricks", { ...connection, token: "dapi" })).toBe(
        true,
      );
    });

    it("keeps a saved personal access token", () => {
      expect(canTest("databricks", connection, true)).toBe(true);
    });

    it("requires the client id and secret for OAuth", () => {
      expect(
        canTest("databricks", {
          ...connection,
          authType: "oauth-m2m",
          oauthClientId: "client",
        }),
      ).toBe(false);
      expect(
        canTest("databricks", {
          ...connection,
          authType: "oauth-m2m",
          oauthClientId: "client",
          oauthClientSecret: "secret",
        }),
      ).toBe(true);
    });

    it("keeps a saved OAuth secret but still requires the client id", () => {
      expect(
        canTest(
          "databricks",
          { ...connection, authType: "oauth-m2m", oauthClientSecret: "" },
          true,
        ),
      ).toBe(false);
      expect(
        canTest(
          "databricks",
          {
            ...connection,
            authType: "oauth-m2m",
            oauthClientId: "client",
          },
          true,
        ),
      ).toBe(true);
    });
  });

  describe("password warehouses", () => {
    const sql = {
      host: "db.example",
      port: 5432,
      database: "analytics",
      user: "growthbook",
      password: "pw",
    };

    it.each(["postgres", "redshift", "vertica", "mysql"] as const)(
      "accepts %s with a password and keeps a saved password",
      (type) => {
        expect(canTest(type, sql)).toBe(true);
        expect(canTest(type, { ...sql, password: "" })).toBe(false);
        expect(canTest(type, { ...sql, password: "" }, true)).toBe(true);
      },
    );

    it("uses server rather than host for SQL Server", () => {
      const mssql = {
        server: "db.example",
        port: "1433",
        database: "analytics",
        user: "growthbook",
        password: "pw",
      };
      expect(canTest("mssql", { ...mssql, server: "" })).toBe(false);
      expect(canTest("mssql", mssql)).toBe(true);
      expect(canTest("mssql", { ...mssql, password: "" }, true)).toBe(true);
    });
  });

  describe("clickhouse", () => {
    it("requires the url and port and no secret", () => {
      expect(
        canTest("clickhouse", { url: "http://ch.example", port: 8123 }),
      ).toBe(true);
      expect(canTest("clickhouse", { url: "http://ch.example" })).toBe(false);
    });
  });

  describe("athena", () => {
    const location = { region: "us-east-1", bucketUri: "s3://results/" };
    const keys = { accessKeyId: "AKIA", secretAccessKey: "secret" };

    it("requires access keys by default", () => {
      expect(canTest("athena", location)).toBe(false);
      expect(canTest("athena", { ...location, ...keys })).toBe(true);
      expect(
        canTest("athena", { ...location, accessKeyId: "AKIA" }, true),
      ).toBe(true);
    });

    it("allows the instance role when self-hosted", () => {
      expect(canTest("athena", { ...location, authType: "auto" })).toBe(true);
    });

    it("still requires access keys for the instance role on Cloud", () => {
      cloud.value = true;
      expect(canTest("athena", { ...location, authType: "auto" })).toBe(false);
      expect(
        canTest("athena", { ...location, ...keys, authType: "auto" }),
      ).toBe(true);
    });

    it("requires the assume-role fields and keeps saved ones", () => {
      const role = {
        ...location,
        authType: "assumeRole",
        assumeRoleARN: "arn:aws:iam::123:role/growthbook",
        roleSessionName: "growthbook",
        externalId: "external",
      };
      expect(canTest("athena", { ...role, externalId: "" })).toBe(false);
      expect(canTest("athena", role)).toBe(true);
      expect(
        canTest("athena", { ...location, authType: "assumeRole" }, true),
      ).toBe(true);
    });

    it("requires the region and bucket", () => {
      expect(
        canTest("athena", { ...keys, bucketUri: location.bucketUri }),
      ).toBe(false);
    });
  });

  describe("presto", () => {
    const connection = { engine: "trino", host: "trino.example" };

    it("requires a username and password for basic auth", () => {
      expect(canTest("presto", { ...connection, username: "growthbook" })).toBe(
        false,
      );
      expect(
        canTest("presto", {
          ...connection,
          username: "growthbook",
          password: "pw",
        }),
      ).toBe(true);
      expect(
        canTest("presto", { ...connection, username: "growthbook" }, true),
      ).toBe(true);
    });

    it("requires the custom auth secret and keeps a saved one", () => {
      expect(canTest("presto", { ...connection, authType: "customAuth" })).toBe(
        false,
      );
      expect(
        canTest("presto", {
          ...connection,
          authType: "customAuth",
          customAuth: "token",
        }),
      ).toBe(true);
      expect(
        canTest("presto", { ...connection, authType: "customAuth" }, true),
      ).toBe(true);
    });

    it("requires the Kerberos service principal", () => {
      expect(canTest("presto", { ...connection, authType: "kerberos" })).toBe(
        false,
      );
      expect(
        canTest("presto", {
          ...connection,
          authType: "kerberos",
          kerberosServicePrincipal: "trino/trino.example",
        }),
      ).toBe(true);
    });

    it("allows an auth type with no extra fields", () => {
      expect(canTest("presto", { ...connection, authType: "none" })).toBe(true);
    });
  });

  describe("mixpanel", () => {
    const account = { username: "svc", projectId: "123", secret: "secret" };

    it("requires the service account secret and keeps a saved one", () => {
      expect(canTest("mixpanel", { ...account, secret: "" })).toBe(false);
      expect(canTest("mixpanel", account)).toBe(true);
      expect(canTest("mixpanel", { ...account, secret: "" }, true)).toBe(true);
    });
  });

  describe("adobe experience platform", () => {
    const account = {
      host: "query.example",
      port: "80",
      database: "prod",
      username: "svc",
      technicalAccountId: "tech",
      credential: "credential",
    };

    it("requires the credential and keeps a saved one", () => {
      expect(
        canTest("adobe_experience_platform_query_service", {
          ...account,
          credential: "",
        }),
      ).toBe(false);
      expect(canTest("adobe_experience_platform_query_service", account)).toBe(
        true,
      );
      expect(
        canTest(
          "adobe_experience_platform_query_service",
          { ...account, credential: "" },
          true,
        ),
      ).toBe(true);
    });
  });
});
