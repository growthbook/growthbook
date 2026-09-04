import {
  decryptSlackBotToken,
  encryptSlackBotToken,
  isEncryptedSlackBotToken,
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
