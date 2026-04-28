import { parse as uuidParse, v7 as uuidv7 } from "uuid";

const BASE58_ALPHABET =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
// 16 bytes (UUIDv7) base58-encode to at most ⌈log₅₈(2¹²⁸)⌉ = 22 chars.
// Pad shorter encodings with the base58 zero-digit so width is stable.
const BASE58_WIDTH = 22;

/**
 * Generate an opaque, sortable resource id. Drop-in replacement for
 * `uniqid(prefix)`.
 *
 * Format: `prefix + "2" + base58(uuidv7)` — e.g. `qry_21CaYDxMweieUAr1YaiBC2d`.
 *
 * - **uuidv7** keeps the unix-ms timestamp at the front, so lexicographic
 *   id sort tracks creation time.
 * - **base58** packs all 128 bits into 22 chars without losing entropy
 *   (vs. truncated hex which sacrifices random bits for length).
 * - **The literal `"2"` prefix** keeps new ids sorting after legacy
 *   `uniqid`-generated ids, which all start with `"1"` (uniqid encodes
 *   address+pid+time in base36, and the leading address byte was always
 *   in the `1xx` range). Sort order across the migration stays intact.
 */
export function generateId(prefix = ""): string {
  const bytes = uuidParse(uuidv7());
  let n = 0n;
  for (const b of bytes) {
    n = (n << 8n) | BigInt(b);
  }
  let suffix = "";
  while (n > 0n) {
    suffix = BASE58_ALPHABET[Number(n % 58n)] + suffix;
    n = n / 58n;
  }
  return prefix + "2" + suffix.padStart(BASE58_WIDTH, BASE58_ALPHABET[0]);
}
