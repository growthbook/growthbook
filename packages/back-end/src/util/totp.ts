import crypto from "crypto";

// RFC 6238 TOTP with the parameters every authenticator app defaults to
const STEP_SECONDS = 30;
const DIGITS = 6;
const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Buffer): string {
  let out = "";
  let bits = 0;
  let value = 0;
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
    value &= (1 << bits) - 1;
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

export function generateTotpSecret(): Buffer {
  return crypto.randomBytes(20);
}

export function getOtpauthUrl(secret: Buffer, accountName: string): string {
  const label = encodeURIComponent(`GrowthBook:${accountName}`);
  return `otpauth://totp/${label}?secret=${base32Encode(secret)}&issuer=GrowthBook`;
}

function hotp(key: Buffer, counter: number): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac("sha1", key).update(msg).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const bin = hmac.readUInt32BE(offset) & 0x7fffffff;
  return String(bin % 10 ** DIGITS).padStart(DIGITS, "0");
}

// Returns the matched time step so callers can reject a replay of it, or null
export function verifyTotp(
  key: Buffer,
  code: string,
  lastUsedStep?: number,
  now = Date.now(),
): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const current = Math.floor(now / 1000 / STEP_SECONDS);
  // One step either side tolerates clock drift
  for (const step of [current - 1, current, current + 1]) {
    if (lastUsedStep !== undefined && step <= lastUsedStep) continue;
    if (crypto.timingSafeEqual(Buffer.from(hotp(key, step)), Buffer.from(code)))
      return step;
  }
  return null;
}
