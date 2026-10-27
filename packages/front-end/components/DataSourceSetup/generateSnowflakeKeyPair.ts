export type SnowflakeKeyPair = {
  /** Unencrypted PKCS#8 PEM. Goes in the connection's Private Key field. */
  privateKey: string;
  /** Base64 SPKI body with no PEM delimiters, as Snowflake's RSA_PUBLIC_KEY expects. */
  publicKey: string;
};

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function toPem(buffer: ArrayBuffer, label: string): string {
  const lines = toBase64(buffer).match(/.{1,64}/g) ?? [];
  return `-----BEGIN ${label}-----\n${lines.join("\n")}\n-----END ${label}-----\n`;
}

/**
 * Generates an RSA-2048 key pair for Snowflake key-pair auth so the user does
 * not have to run openssl. Resolves to null when WebCrypto is unavailable
 * (self-hosted GrowthBook served over plain HTTP is not a secure context).
 */
export async function generateSnowflakeKeyPair(): Promise<SnowflakeKeyPair | null> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return null;
  try {
    const keys = await subtle.generateKey(
      {
        name: "RSASSA-PKCS1-v1_5",
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: "SHA-256",
      },
      true,
      ["sign", "verify"],
    );
    const [pkcs8, spki] = await Promise.all([
      subtle.exportKey("pkcs8", keys.privateKey),
      subtle.exportKey("spki", keys.publicKey),
    ]);
    return {
      privateKey: toPem(pkcs8, "PRIVATE KEY"),
      publicKey: toBase64(spki),
    };
  } catch {
    return null;
  }
}
