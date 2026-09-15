import { normalizeSnowflakePrivateKeyForEventForwarder } from "back-end/src/services/eventForwarder/config";

describe("normalizeSnowflakePrivateKeyForEventForwarder", () => {
  it("strips unencrypted PKCS#8 PEM headers and \\n line endings", () => {
    const pem = [
      "-----BEGIN PRIVATE KEY-----",
      "MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC7VJTUt9Us8cKj",
      "MzEfYyjiWA4R4/M2bS1GB4t7NXp98C3SC6dVMvDuictGeurT8jNbvJZHtCSuYEvu",
      "-----END PRIVATE KEY-----",
      "",
    ].join("\n");

    const result = normalizeSnowflakePrivateKeyForEventForwarder(pem);

    expect(result).toBe(
      "MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC7VJTUt9Us8cKjMzEfYyjiWA4R4/M2bS1GB4t7NXp98C3SC6dVMvDuictGeurT8jNbvJZHtCSuYEvu",
    );
    expect(result).not.toContain("BEGIN");
    expect(result).not.toContain("END");
    expect(result).not.toMatch(/\s/);
  });

  it("strips encrypted PKCS#8 PEM headers and \\r\\n line endings", () => {
    const pem = [
      "-----BEGIN ENCRYPTED PRIVATE KEY-----",
      "MIIFLTBXBgkqhkiG9w0BBQ0wSjApBgkqhkiG9w0BBQwwHAQIaG/jmZyvAnMCAggA",
      "MAwGCCqGSIb3DQIJBQAwHQYJYIZIAWUDBAEqBBBkbz5TAH8K2g3xQ9Hf1aA1BIIE",
      "-----END ENCRYPTED PRIVATE KEY-----",
      "",
    ].join("\r\n");

    const result = normalizeSnowflakePrivateKeyForEventForwarder(pem);

    expect(result).toBe(
      "MIIFLTBXBgkqhkiG9w0BBQ0wSjApBgkqhkiG9w0BBQwwHAQIaG/jmZyvAnMCAggAMAwGCCqGSIb3DQIJBQAwHQYJYIZIAWUDBAEqBBBkbz5TAH8K2g3xQ9Hf1aA1BIIE",
    );
    expect(result).not.toContain("BEGIN");
    expect(result).not.toContain("END");
    expect(result).not.toMatch(/\s/);
  });

  it("leaves an already-normalized base64 blob unchanged", () => {
    const normalized =
      "MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC7VJTUt9Us8cKj";

    expect(normalizeSnowflakePrivateKeyForEventForwarder(normalized)).toBe(
      normalized,
    );
  });

  it("strips interior tabs and spaces in addition to newlines", () => {
    const messy = "  MIIE\tvQIB ADAN\nBgkq\r\n hkiG ";

    expect(normalizeSnowflakePrivateKeyForEventForwarder(messy)).toBe(
      "MIIEvQIBADANBgkqhkiG",
    );
  });

  it("returns empty string for undefined, empty, or whitespace-only input", () => {
    expect(normalizeSnowflakePrivateKeyForEventForwarder(undefined)).toBe("");
    expect(normalizeSnowflakePrivateKeyForEventForwarder("")).toBe("");
    expect(normalizeSnowflakePrivateKeyForEventForwarder("   \n\r\t  ")).toBe(
      "",
    );
  });
});
