import { AdobeEpConnectionParams } from "shared/types/integrations/adobe-ep";
import { toPostgresConnection } from "back-end/src/integrations/AdobeEpQueryService";
import { adobeEpDialect } from "back-end/src/integrations/dialects/adobeEp";

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

  it("does not double the suffix when the org id is pasted with @AdobeOrg", () => {
    expect(
      toPostgresConnection({
        ...baseParams,
        orgId: "ECBB80245ECFC73E8A095EC9@AdobeOrg",
      }).user,
    ).toBe("ECBB80245ECFC73E8A095EC9@AdobeOrg");
  });

  it("strips surrounding whitespace and a case-insensitive suffix", () => {
    expect(
      toPostgresConnection({
        ...baseParams,
        orgId: " ECBB80245ECFC73E8A095EC9@adobeorg ",
      }).user,
    ).toBe("ECBB80245ECFC73E8A095EC9@AdobeOrg");
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

describe("adobeEpDialect", () => {
  it("wraps timestamp literals in to_timestamp()", () => {
    expect(adobeEpDialect.toTimestamp(new Date("2026-01-02T03:04:05Z"))).toBe(
      "to_timestamp('2026-01-02 03:04:05')",
    );
  });

  it("escapes quotes and backslashes with a backslash, Spark-style", () => {
    expect(adobeEpDialect.escapeStringLiteral("It's")).toBe(String.raw`It\'s`);
    expect(adobeEpDialect.escapeStringLiteral(String.raw`a\b`)).toBe(
      String.raw`a\\b`,
    );
  });
});
