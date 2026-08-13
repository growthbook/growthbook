import { AdobeEpConnectionParams } from "shared/types/integrations/adobe-ep";
import { toPostgresConnection } from "back-end/src/integrations/AdobeEpQueryService";

const baseParams: AdobeEpConnectionParams = {
  host: "acme.platform.adobe.io",
  port: 5432,
  orgId: "ECBB80245ECFC73E8A095EC9",
  sandbox: "prod",
  container: "all",
  flatten: false,
  technicalAccountId: "tech-account-123",
  credential: "s3cr3t",
};

describe("toPostgresConnection", () => {
  it("composes the sandbox:container database string", () => {
    expect(toPostgresConnection(baseParams).database).toBe("prod:all");
  });

  it("appends ?FLATTEN when flatten is true", () => {
    expect(
      toPostgresConnection({ ...baseParams, flatten: true }).database,
    ).toBe("prod:all?FLATTEN");
  });

  it("appends @AdobeOrg to the org id", () => {
    expect(toPostgresConnection(baseParams).user).toBe(
      "ECBB80245ECFC73E8A095EC9@AdobeOrg",
    );
  });

  it("joins technicalAccountId and credential with a colon as the password", () => {
    expect(toPostgresConnection(baseParams).password).toBe(
      "tech-account-123:s3cr3t",
    );
  });

  it("forces TLS", () => {
    expect(toPostgresConnection(baseParams).ssl).toBe(true);
  });

  it("passes host and port through and leaves defaultSchema empty", () => {
    const conn = toPostgresConnection(baseParams);
    expect(conn.host).toBe("acme.platform.adobe.io");
    expect(conn.port).toBe(5432);
    expect(conn.defaultSchema).toBe("");
  });
});
