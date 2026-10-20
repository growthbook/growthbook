import { AES } from "crypto-js";
import {
  decryptAIKey,
  encryptAIKey,
  getKeyLast4,
  missingAIKeyMessage,
} from "back-end/src/services/aiCredentials";

// CryptoJS has no wrong-key signal: invalid bytes may return an empty string,
// throw during UTF-8 decoding, or rarely decode to another string.
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
    const key = "sk-proj-supersecretvalue";
    expect(encryptAIKey(key)).not.toBe(encryptAIKey(key));
  });

  it("does not throw or return plaintext when the key is wrong", () => {
    for (let i = 0; i < 200; i++) {
      const ciphertext = AES.encrypt("sk-real-key", "another-key").toString();
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
