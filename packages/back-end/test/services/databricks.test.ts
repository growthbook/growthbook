import { DatabricksConnectionParams } from "shared/types/integrations/databricks";
import { buildDatabricksConnectionOptions } from "back-end/src/services/databricks";
import { encryptParams } from "back-end/src/services/datasource";
import Databricks from "back-end/src/integrations/Databricks";

const sharedParams = {
  host: "dbc-12345.cloud.databricks.com",
  port: 443,
  path: "/sql/1.0/warehouses/abc123",
  catalog: "main",
  clientId: "MyApp",
} as const;

describe("buildDatabricksConnectionOptions", () => {
  it("builds PAT options with a token and no authType (driver default access-token)", () => {
    const conn: DatabricksConnectionParams = {
      ...sharedParams,
      authType: "pat",
      token: "dapi-secret-token",
    };

    const options = buildDatabricksConnectionOptions(conn);

    expect(options).toEqual({
      host: sharedParams.host,
      port: sharedParams.port,
      path: sharedParams.path,
      userAgentEntry: sharedParams.clientId,
      token: "dapi-secret-token",
    });
    expect("authType" in options).toBe(false);
  });

  it("falls back to the token path when authType is absent (legacy record)", () => {
    const legacy = {
      ...sharedParams,
      token: "dapi-legacy-token",
      // authType omitted, as a pre-OAuth row would be
    } as unknown as DatabricksConnectionParams;

    const options = buildDatabricksConnectionOptions(legacy);

    expect(options).toEqual({
      host: sharedParams.host,
      port: sharedParams.port,
      path: sharedParams.path,
      userAgentEntry: sharedParams.clientId,
      token: "dapi-legacy-token",
    });
    expect("authType" in options).toBe(false);
  });

  it("builds OAuth M2M options with the databricks-oauth authType and client credentials", () => {
    const conn: DatabricksConnectionParams = {
      ...sharedParams,
      authType: "oauth-m2m",
      oauthClientId: "service-principal-app-id",
      oauthClientSecret: "oauth-secret",
    };

    const options = buildDatabricksConnectionOptions(conn);

    expect(options).toEqual({
      host: sharedParams.host,
      port: sharedParams.port,
      path: sharedParams.path,
      userAgentEntry: sharedParams.clientId,
      authType: "databricks-oauth",
      oauthClientId: "service-principal-app-id",
      oauthClientSecret: "oauth-secret",
    });
    expect("token" in options).toBe(false);
  });

  it("shares host/port/path/userAgentEntry across both auth methods and defaults them", () => {
    const base = {
      host: "host.databricks.com",
      path: "/sql/path",
      catalog: "main",
      // port omitted → defaults to 443; userAgentEntry omitted → defaults to "GrowthBook"
    } as unknown as DatabricksConnectionParams;

    const pat = buildDatabricksConnectionOptions({
      ...base,
      authType: "pat",
      token: "t",
    });
    const oauth = buildDatabricksConnectionOptions({
      ...base,
      authType: "oauth-m2m",
      oauthClientId: "id",
      oauthClientSecret: "secret",
    });

    for (const options of [pat, oauth]) {
      expect(options.host).toBe("host.databricks.com");
      expect(options.port).toBe(443);
      expect(options.path).toBe("/sql/path");
      expect(options.userAgentEntry).toBe("GrowthBook");
    }
  });
});

describe("Databricks.setParams legacy authType fallback", () => {
  const storedShape = {
    host: "dbc-12345.cloud.databricks.com",
    port: 443,
    path: "/sql/1.0/warehouses/abc123",
    catalog: "main",
  };

  it("coerces a legacy record with no authType to pat", () => {
    const encrypted = encryptParams({
      ...storedShape,
      token: "dapi-legacy-token",
      // no authType — this is what a pre-OAuth row looks like
    } as unknown as Parameters<typeof encryptParams>[0]);

    // @ts-expect-error -- only datasource.params is exercised by setParams
    const integration = new Databricks("", { params: encrypted });

    expect(integration.params.authType).toBe("pat");
    expect(integration.params.token).toBe("dapi-legacy-token");
  });

  it("preserves an explicit authType rather than overwriting it", () => {
    const encrypted = encryptParams({
      ...storedShape,
      authType: "oauth-m2m",
      oauthClientId: "id",
      oauthClientSecret: "secret",
    } as unknown as Parameters<typeof encryptParams>[0]);

    // @ts-expect-error -- only datasource.params is exercised by setParams
    const integration = new Databricks("", { params: encrypted });

    expect(integration.params.authType).toBe("oauth-m2m");
  });
});
