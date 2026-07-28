import { AES } from "crypto-js";
import {
  decryptAIKey,
  encryptAIKey,
  getKeyLast4,
  missingAIKeyMessage,
} from "back-end/src/services/aiCredentials";

// Keys are stored as AES ciphertext under the install's ENCRYPTION_KEY (which
// is "dev" in tests). The important behaviours here are the round trip and the
// wrong-key case: crypto-js does NOT throw on a bad key, it returns an empty
// string, so callers must check the value rather than rely on a rejection.
describe("AI credential encryption", () => {
  it("round-trips a key", () => {
    const key = "sk-ant-api03-abcdefghijklmnop";
    expect(decryptAIKey(encryptAIKey(key))).toBe(key);
  });

  it("does not store the plaintext key in the ciphertext", () => {
    const key = "sk-proj-supersecretvalue";
    expect(encryptAIKey(key)).not.toContain(key);
  });

  it("produces different ciphertext for the same key each time", () => {
    // crypto-js salts each encryption, so identical keys must not produce
    // identical ciphertext — otherwise the stored value leaks equality.
    const key = "sk-proj-supersecretvalue";
    expect(encryptAIKey(key)).not.toBe(encryptAIKey(key));
  });

  it("returns an empty string when decrypting with the wrong key", () => {
    // Simulates ENCRYPTION_KEY changing without running the migration script.
    const ciphertext = AES.encrypt("sk-real-key", "some-other-key").toString();
    expect(decryptAIKey(ciphertext)).toBe("");
  });

  it("returns an empty string for a value that is not ciphertext", () => {
    expect(decryptAIKey("not-encrypted-at-all")).toBe("");
  });
});

describe("getKeyLast4", () => {
  it("returns the last 4 characters of a normal key", () => {
    expect(getKeyLast4("sk-ant-api03-abcd1234")).toBe("1234");
  });

  it("returns nothing for a short key rather than leaking most of it", () => {
    expect(getKeyLast4("abc")).toBe("");
    expect(getKeyLast4("abcdefg")).toBe("");
  });

  it("returns the last 4 at the 8-character boundary", () => {
    expect(getKeyLast4("abcdefgh")).toBe("efgh");
  });
});

describe("missingAIKeyMessage", () => {
  it("names both the settings page and the provider's env var", () => {
    const message = missingAIKeyMessage("anthropic");
    expect(message).toContain("Anthropic");
    expect(message).toContain("ANTHROPIC_API_KEY");
  });

  it("uses the preferred env var name for Google, not the legacy one", () => {
    const message = missingAIKeyMessage("google");
    expect(message).toContain("GOOGLE_AI_API_KEY");
    expect(message).not.toContain("GEMINI_API_KEY");
  });
});
