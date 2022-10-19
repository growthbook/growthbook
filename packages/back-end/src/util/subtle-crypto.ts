// eslint-disable-next-line
const { subtle } = require("node:crypto").webcrypto;

function stringToBuffer(str: string): ArrayBuffer {
  const buf = new ArrayBuffer(str.length);
  const bufView = new Uint8Array(buf);
  for (let i = 0, strLen = str.length; i < strLen; i++) {
    bufView[i] = str.charCodeAt(i);
  }
  return buf;
}

export async function generatePrivateKey() {
  const exportedKey = await subtle.exportKey(
    "raw",
    await subtle.generateKey(
      {
        name: "AES-CBC",
        length: 256,
      },
      true,
      ["encrypt", "decrypt"]
    )
  );
  const buffer = new Uint8Array(exportedKey);
  return Buffer.from(buffer).toString("base64");
}

export async function getKeyFromString(keyString: string): Promise<CryptoKey> {
  const binaryString = atob(keyString);
  const buffer = stringToBuffer(binaryString);
  return subtle.importKey(
    "raw",
    buffer,
    {
      name: "AES-CBC",
    },
    true,
    ["encrypt", "decrypt"]
  );
}
