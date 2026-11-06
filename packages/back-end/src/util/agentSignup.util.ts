import crypto from "crypto";
import { IS_CLOUD } from "back-end/src/util/secrets";

// Twenty letters with no look-alikes, so a code read off a terminal and typed
// into a browser survives the trip. Eight of them is about 26 billion codes.
export const LINK_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTVWX";
const LINK_CODE_LENGTH = 8;

export function generateLinkCode(): string {
  let code = "";
  while (code.length < LINK_CODE_LENGTH) {
    // Rejection sampling keeps every letter equally likely.
    const byte = crypto.randomBytes(1)[0];
    if (byte >= 240) continue;
    code += LINK_CODE_ALPHABET[byte % LINK_CODE_ALPHABET.length];
  }
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

// What a person typed, in the form it was issued: upper case, four-dash-four.
// Empty when it cannot be a code, so callers never hash garbage.
export function normalizeLinkCode(input: string): string {
  const letters = input.toUpperCase().replace(/[^A-Z]/g, "");
  if (letters.length !== LINK_CODE_LENGTH) return "";
  if ([...letters].some((c) => !LINK_CODE_ALPHABET.includes(c))) return "";
  return `${letters.slice(0, 4)}-${letters.slice(4)}`;
}

export function hashLinkCode(code: string): string {
  return crypto.createHash("sha256").update(code).digest("hex");
}

export function sandboxExpiry(from: Date, lifetimeDays: number): Date {
  return new Date(from.getTime() + lifetimeDays * 24 * 60 * 60 * 1000);
}

// Where the SDK fetches from. Cloud serves SDK payloads from its CDN; anywhere
// else the API host serves them itself.
export function sdkHostFor(apiHost: string): string {
  return IS_CLOUD ? "https://cdn.growthbook.io" : apiHost;
}
