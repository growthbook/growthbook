import { createPrivateKey, createPublicKey } from "crypto";
import { generateSnowflakeKeyPair } from "@/components/DataSourceSetup/generateSnowflakeKeyPair";

describe("generateSnowflakeKeyPair", () => {
  it("produces a PKCS#8 PEM the back-end can load and a matching bare public key", async () => {
    const keyPair = await generateSnowflakeKeyPair();
    expect(keyPair).not.toBeNull();
    if (!keyPair) return;

    expect(keyPair.privateKey).toMatch(/^-----BEGIN PRIVATE KEY-----\n/);
    expect(keyPair.privateKey).toMatch(/\n-----END PRIVATE KEY-----\n$/);
    // Same call the Snowflake service makes, with no passphrase.
    const privateKey = createPrivateKey({
      key: keyPair.privateKey,
      format: "pem",
    });
    expect(privateKey.asymmetricKeyType).toBe("rsa");

    // Snowflake's RSA_PUBLIC_KEY takes the base64 body without delimiters.
    expect(keyPair.publicKey).not.toContain("-----");
    expect(keyPair.publicKey).not.toContain("\n");
    const derived = createPublicKey(privateKey)
      .export({ type: "spki", format: "pem" })
      .toString()
      .replace(/-----(BEGIN|END) PUBLIC KEY-----|\n/g, "");
    expect(keyPair.publicKey).toBe(derived);
  });

  it("returns null when WebCrypto is unavailable", async () => {
    const original = globalThis.crypto;
    Object.defineProperty(globalThis, "crypto", {
      value: undefined,
      configurable: true,
    });
    try {
      expect(await generateSnowflakeKeyPair()).toBeNull();
    } finally {
      Object.defineProperty(globalThis, "crypto", {
        value: original,
        configurable: true,
      });
    }
  });
});
