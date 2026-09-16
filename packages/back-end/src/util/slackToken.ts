import { AES, enc } from "crypto-js";
import { ENCRYPTION_KEY } from "back-end/src/util/secrets";

const ENCRYPTED_SLACK_TOKEN_PREFIX = "encrypted:v1:";

export const isEncryptedSlackBotToken = (token: string): boolean =>
  token.startsWith(ENCRYPTED_SLACK_TOKEN_PREFIX);

export const encryptSlackBotToken = (token: string): string =>
  isEncryptedSlackBotToken(token)
    ? token
    : `${ENCRYPTED_SLACK_TOKEN_PREFIX}${AES.encrypt(
        token,
        ENCRYPTION_KEY,
      ).toString()}`;

export const decryptSlackBotToken = (
  storedToken: string,
  encryptionKey = ENCRYPTION_KEY,
): string | null => {
  if (!isEncryptedSlackBotToken(storedToken)) return storedToken;

  try {
    const token = AES.decrypt(
      storedToken.slice(ENCRYPTED_SLACK_TOKEN_PREFIX.length),
      encryptionKey,
    ).toString(enc.Utf8);
    return token || null;
  } catch {
    return null;
  }
};

export const reencryptSlackBotToken = (
  storedToken: string,
  oldEncryptionKey: string,
): string => {
  // CBC decryption with the wrong key can return nonempty garbage.
  const isBotToken = (token: string | null) =>
    token !== null && /^(?:xoxb-|xoxe\.xoxb-)[A-Za-z0-9_-]+$/.test(token);
  if (
    isEncryptedSlackBotToken(storedToken) &&
    isBotToken(decryptSlackBotToken(storedToken))
  ) {
    return storedToken;
  }
  const token = decryptSlackBotToken(storedToken, oldEncryptionKey);
  if (!token || !isBotToken(token)) {
    throw new Error(
      "Could not decrypt the Slack bot token with either encryption key",
    );
  }
  return encryptSlackBotToken(token);
};
