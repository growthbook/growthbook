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

export const decryptSlackBotToken = (storedToken: string): string | null => {
  if (!isEncryptedSlackBotToken(storedToken)) return storedToken;

  try {
    const token = AES.decrypt(
      storedToken.slice(ENCRYPTED_SLACK_TOKEN_PREFIX.length),
      ENCRYPTION_KEY,
    ).toString(enc.Utf8);
    return token || null;
  } catch {
    return null;
  }
};
