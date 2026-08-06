import { AES } from "crypto-js";
import {
  decryptAIKey,
  encryptAIKey,
  getKeyLast4,
  missingAIKeyMessage,
} from "back-end/src/services/aiCredentials";

// The wrong-key case has no clean signal: garbage bytes make `.toString(enc.Utf8)`
// return "" (usually), throw "Malformed UTF-8 data" (~5%), or rarely return a
// short valid string. decryptAIKey collapses the throw into "", so the only
// invariants that always hold are "never throws" and "never returns the
// plaintext" — asserting `=== ""` would be a flaky test, not a stronger one.
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
    // Salted, so identical keys must not produce identical ciphertext.
    const key = "sk-proj-supersecretvalue";
    expect(encryptAIKey(key)).not.toBe(encryptAIKey(key));
  });

  it("never throws on a wrong key, whatever the garbage bytes decode to", () => {
    // Regression guard for the try/catch in decryptAIKey. Which outcome a given
    // ciphertext draws depends on its salt, so repeating makes the throwing
    // branch effectively certain to be covered — getResolvedAIKeys relies on it
    // to fall back to the env var instead of failing every AI request.
    for (let i = 0; i < 200; i++) {
      const ciphertext = AES.encrypt("sk-real-key", "another-key").toString();
      expect(() => decryptAIKey(ciphertext)).not.toThrow();
    }
  });

  it("never returns the original plaintext when the key is wrong", () => {
    // Simulates ENCRYPTION_KEY changing without running the migration script.
    // The security property, unlike the exact return value, always holds.
    for (let i = 0; i < 200; i++) {
      const ciphertext = AES.encrypt(
        "sk-real-key",
        "some-other-key",
      ).toString();
      expect(decryptAIKey(ciphertext)).not.toBe("sk-real-key");
    }
  });

  it("does not throw on a value that is not ciphertext", () => {
    expect(() => decryptAIKey("not-encrypted-at-all")).not.toThrow();
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
