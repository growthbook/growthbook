// Letters and digits only so the value is safe inside single-quoted SQL
// literals and shell commands without escaping.
const ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const LENGTH = 24; // ~143 bits of entropy

/** Password prefilled for new warehouse users created from the connect page. */
export function generateStrongPassword(): string {
  const bytes = new Uint8Array(LENGTH);
  crypto.getRandomValues(bytes);
  // Modulo bias is negligible for a 62-character alphabet (256 % 62 = 8).
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
}
