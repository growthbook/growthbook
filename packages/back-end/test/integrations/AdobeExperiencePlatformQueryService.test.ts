import { AdobeExperiencePlatformQueryServiceConnectionParams } from "shared/types/integrations/adobe-experience-platform-query-service";
import { toPostgresConnectionParams } from "back-end/src/integrations/AdobeExperiencePlatformQueryService";
import { adobeExperiencePlatformQueryServiceDialect } from "back-end/src/integrations/dialects/adobeExperiencePlatformQueryService";

const baseParams: AdobeExperiencePlatformQueryServiceConnectionParams = {
  host: "acme.platform.adobe.io",
  port: 80,
  database: "prod:all",
  username: "ECBB80245ECFC73E8A095EC9@AdobeOrg",
  technicalAccountId: "tech-account-123",
  credential: "s3cr3t",
};

describe("toPostgresConnectionParams", () => {
  it("passes through Adobe's connection values", () => {
    const conn = toPostgresConnectionParams(baseParams);
    expect(conn.host).toBe("acme.platform.adobe.io");
    expect(conn.port).toBe(80);
    expect(conn.database).toBe("prod:all");
    expect(conn.user).toBe("ECBB80245ECFC73E8A095EC9@AdobeOrg");
  });

  it("joins technicalAccountId and credential with a colon as the password", () => {
    expect(toPostgresConnectionParams(baseParams).password).toBe(
      "tech-account-123:s3cr3t",
    );
  });

  it("forces TLS", () => {
    expect(toPostgresConnectionParams(baseParams).ssl).toBe(true);
  });

  it("leaves defaultSchema empty", () => {
    const conn = toPostgresConnectionParams(baseParams);
    expect(conn.defaultSchema).toBe("");
  });
});

describe("Adobe Experience Platform Query Service dialect", () => {
  it("wraps timestamp literals in to_timestamp()", () => {
    expect(
      adobeExperiencePlatformQueryServiceDialect.toTimestamp(
        new Date("2026-01-02T03:04:05Z"),
      ),
    ).toBe("to_timestamp('2026-01-02 03:04:05')");
  });

  it("escapes quotes and backslashes with a backslash, Spark-style", () => {
    expect(
      adobeExperiencePlatformQueryServiceDialect.escapeStringLiteral("It's"),
    ).toBe(String.raw`It\'s`);
    expect(
      adobeExperiencePlatformQueryServiceDialect.escapeStringLiteral(
        String.raw`a\b`,
      ),
    ).toBe(String.raw`a\\b`);
  });
});
