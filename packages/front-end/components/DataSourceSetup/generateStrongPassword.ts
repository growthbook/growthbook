// Letters and digits only so the value is safe inside single-quoted SQL
// literals and shell commands without escaping.
const ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

/**
 * Password prefilled for new warehouse users created from the connect page.
 * 24 alphanumeric characters is ~143 bits of entropy.
 */
export function generateStrongPassword(length = 24): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  // Modulo bias is negligible for a 62-character alphabet (256 % 62 = 8).
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
}
