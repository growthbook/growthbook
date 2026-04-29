import { parse as uuidParse, v7 as uuidv7 } from "uuid";
import bs58 from "bs58";

/**
 * Generate a sortable, opaque, resource id.
 *
 * Replaces uniqid(prefix), with lower chances of collision
 *
 * uuid is prefixed by '2' to differentiate from uniqid(prefix)
 * and is base58 to reduce the length of the id
 *
 * Format: `prefix + "2" + base58(uuidv7)` — e.g. `qry_2CaYDxMweieUAr1YaiBC2d`.
 */
export function generateId(prefix = ""): string {
  return prefix + "2" + bs58.encode(uuidParse(uuidv7()));
}
