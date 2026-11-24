import { referencedWebhookSecrets } from "shared/validators";

export function parseHeaders(headers: string): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(headers);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return Object.fromEntries(
        Object.entries(parsed).filter(
          (entry): entry is [string, string] => typeof entry[1] === "string",
        ),
      );
    }
  } catch {
    // Not JSON yet.
  }
  return {};
}

// The secret a header is set to, when it is exactly one `{{ KEY }}` reference.
export function headerSecretKey(
  headers: Record<string, string>,
  name: string,
): string {
  const value = headers[name] ?? "";
  const keys = referencedWebhookSecrets(value);
  return keys.length === 1 && value.trim() === `{{ ${keys[0]} }}`
    ? keys[0]
    : "";
}

export function withHeaderSecret(
  headers: string,
  name: string,
  secretKey: string,
): string {
  return JSON.stringify({
    ...parseHeaders(headers),
    [name]: `{{ ${secretKey} }}`,
  });
}
