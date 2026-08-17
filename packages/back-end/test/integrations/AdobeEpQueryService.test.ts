import { AdobeExperiencePlatformQueryServiceConnectionParams } from "shared/types/integrations/adobe-experience-platform-query-service";
import { toPostgresConnection } from "back-end/src/integrations/AdobeEpQueryService";
import { adobeEpDialect } from "back-end/src/integrations/dialects/adobeEp";

const baseParams: AdobeExperiencePlatformQueryServiceConnectionParams = {
  host: "acme.platform.adobe.io",
  port: 80,
  database: "prod:all",
  username: "ECBB80245ECFC73E8A095EC9@AdobeOrg",
  technicalAccountId: "tech-account-123",
  credential: "s3cr3t",
};

describe("toPostgresConnection", () => {
  it("passes through Adobe's connection values", () => {
    const conn = toPostgresConnection(baseParams);
    expect(conn.host).toBe("acme.platform.adobe.io");
    expect(conn.port).toBe(80);
    expect(conn.database).toBe("prod:all");
    expect(conn.user).toBe("ECBB80245ECFC73E8A095EC9@AdobeOrg");
  });

  it("joins technicalAccountId and credential with a colon as the password", () => {
    expect(toPostgresConnection(baseParams).password).toBe(
      "tech-account-123:s3cr3t",
    );
  });

  it("forces TLS", () => {
    expect(toPostgresConnection(baseParams).ssl).toBe(true);
  });

  it("leaves defaultSchema empty", () => {
    const conn = toPostgresConnection(baseParams);
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
