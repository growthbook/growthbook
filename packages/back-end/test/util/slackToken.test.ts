import { AES } from "crypto-js";
import {
  decryptSlackBotToken,
  encryptSlackBotToken,
  isEncryptedSlackBotToken,
  reencryptSlackBotToken,
} from "back-end/src/util/slackToken";

describe("Slack bot token encryption", () => {
  it("encrypts and decrypts bot tokens", () => {
    const token = "xoxb-existing-connection";
    const encrypted = encryptSlackBotToken(token);

    expect(encrypted).not.toContain(token);
    expect(isEncryptedSlackBotToken(encrypted)).toBe(true);
    expect(decryptSlackBotToken(encrypted)).toBe(token);
  });

  it("keeps encrypted values encrypted once", () => {
    const encrypted = encryptSlackBotToken("xoxb-token");

    expect(encryptSlackBotToken(encrypted)).toBe(encrypted);
  });

  it("accepts legacy plaintext tokens", () => {
    expect(decryptSlackBotToken("xoxb-legacy-token")).toBe("xoxb-legacy-token");
  });

  it("rejects malformed encrypted tokens", () => {
    expect(
      decryptSlackBotToken("encrypted:v1:not-valid-ciphertext"),
    ).toBeNull();
  });
});

describe("Slack token key rotation", () => {
  it.each(["xoxb-old_token", "xoxe.xoxb-rotating-token"])(
    "rotates an old-key token and is repeatable: %s",
    (token) => {
      const oldCiphertext = `encrypted:v1:${AES.encrypt(token, "old-key").toString()}`;
      expect(decryptSlackBotToken(oldCiphertext)).not.toBe(token);
      const rotated = reencryptSlackBotToken(oldCiphertext, "old-key");
      expect(rotated).not.toBe(oldCiphertext);
      expect(decryptSlackBotToken(rotated)).toBe(token);
      expect(reencryptSlackBotToken(rotated, "old-key")).toBe(rotated);
    },
  );
  it("encrypts legacy plaintext during rotation", () => {
    const rotated = reencryptSlackBotToken("xoxb-legacy-token", "old-key");
    expect(isEncryptedSlackBotToken(rotated)).toBe(true);
    expect(decryptSlackBotToken(rotated)).toBe("xoxb-legacy-token");
  });
  it("fails rather than overwriting an unreadable token", () => {
    const stored = `encrypted:v1:${AES.encrypt("xoxb-token", "unknown-key").toString()}`;
    expect(() => reencryptSlackBotToken(stored, "old-key")).toThrow(
      "Could not decrypt",
    );
    expect(() =>
      reencryptSlackBotToken("encrypted:v1:corrupt", "old-key"),
    ).toThrow("Could not decrypt");
  });
});
