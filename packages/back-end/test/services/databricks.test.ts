import { DatabricksConnectionParams } from "shared/types/integrations/databricks";
import { buildDatabricksConnectionOptions } from "back-end/src/services/databricks";

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
      clientId: sharedParams.clientId,
      token: "dapi-secret-token",
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
      clientId: sharedParams.clientId,
      authType: "databricks-oauth",
      oauthClientId: "service-principal-app-id",
      oauthClientSecret: "oauth-secret",
    });
    expect("token" in options).toBe(false);
  });

  it("shares host/port/path/clientId across both auth methods and defaults them", () => {
    const base = {
      host: "host.databricks.com",
      path: "/sql/path",
      catalog: "main",
      // port omitted → defaults to 443; clientId omitted → defaults to "GrowthBook"
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
      expect(options.clientId).toBe("GrowthBook");
    }
  });
});
