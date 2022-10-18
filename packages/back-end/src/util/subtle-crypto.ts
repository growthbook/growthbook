// eslint-disable-next-line
const { subtle } = require("crypto").webcrypto;

export function bufferToString(buf: ArrayBuffer): string {
  return String.fromCharCode.apply(
    null,
    Array.from<number>(new Uint8Array(buf))
  );
}

function keyToString(exportedKey: ArrayBuffer): string {
  const exportedAsString = bufferToString(exportedKey);
  return btoa(exportedAsString);
}

export async function publicKeyToString(key: CryptoKey): Promise<string> {
  const exportedKey = await subtle.exportKey("spki", key);
  return keyToString(exportedKey);
}

export async function privateKeyToString(key: CryptoKey): Promise<string> {
  const exportedKey = await subtle.exportKey("pkcs8", key);
  return keyToString(exportedKey);
}

function stringToBuffer(str: string): ArrayBuffer {
  const buf = new ArrayBuffer(str.length);
  const bufView = new Uint8Array(buf);
  for (let i = 0, strLen = str.length; i < strLen; i++) {
    bufView[i] = str.charCodeAt(i);
  }
  return buf;
}

export async function publicKeyStringToBuffer(
  keyString: string
): Promise<ArrayBuffer> {
  const binaryString = atob(keyString);
  const buffer = stringToBuffer(binaryString);
  return await subtle.importKey(
    "spki",
    buffer,
    {
      name: "RSA-OAEP",
      hash: "SHA-256",
    },
    true,
    ["encrypt"]
  );
}
